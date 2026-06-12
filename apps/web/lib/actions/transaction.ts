'use server';

import { redirect } from 'next/navigation';
import { parseEventLogs, keccak256, stringToBytes } from 'viem';
import { EscrowAbi, EscrowFactoryAbi } from '@puente/shared';
import { MockSanctionsScreeningProvider } from '@puente/shared/mocks';
import { createSupabaseServerClient } from '../supabase/server';
import { getServiceClient } from '../supabase/service';
import { publicClient, getBuyerWalletClient, getSupplierWalletClient } from '../chain';
import { deployment } from '../deployments';
import { blTextToBytes32 } from '../format';

const FACTORY_ADDR = deployment.EscrowFactory.proxy as `0x${string}`;
const ESCROW_ADDR = deployment.Escrow.address as `0x${string}`;
const USDC_ADDR = deployment.usdcAddress as `0x${string}`;

const USDC_APPROVE_ABI = [
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const;

const BL_VERIFIED_TYPE = keccak256(stringToBytes('BL_VERIFIED'));
const RECEIPT_CONFIRMED_TYPE = keccak256(stringToBytes('RECEIPT_CONFIRMED'));

async function getAuthUser() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  return user;
}

async function getProfile(userId: string) {
  const db = getServiceClient();
  const { data } = await db
    .from('users')
    .select('*, organization:organizations(*)')
    .eq('id', userId)
    .single();
  return data;
}

async function runSanctionsCheck(
  name: string,
  walletAddress: string,
  country: string,
): Promise<void> {
  const sanctions = new MockSanctionsScreeningProvider();
  const result = await sanctions.screen({ name, walletAddress, country });
  if (!result.cleared) {
    const match = result.matches[0];
    throw new Error(
      `Sanctions match for "${name}": ${match?.list} — ${match?.detail}`,
    );
  }
}

export async function createTransaction(formData: FormData) {
  const user = await getAuthUser();
  const profile = await getProfile(user.id);
  if (!profile) redirect('/onboard');

  const supplierId = formData.get('supplier_id') as string;
  const amountUsdc = formData.get('amount_usdc') as string; // decimal string, e.g. "1000"
  const tranche1Pct = parseInt(formData.get('tranche1_pct') as string, 10) || 30;

  const db = getServiceClient();
  const { data: supplier } = await db
    .from('suppliers')
    .select('*')
    .eq('id', supplierId)
    .single();

  if (!supplier) {
    redirect(`/transactions/new?error=${encodeURIComponent('Supplier not found')}`);
  }

  // Sanctions check on buyer org and supplier
  try {
    await runSanctionsCheck(
      profile.organization.name,
      profile.organization.wallet_address ?? '',
      profile.organization.country,
    );
    await runSanctionsCheck(
      supplier.legal_name,
      supplier.wallet_address,
      supplier.registration_country,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    redirect(`/transactions/new?error=${encodeURIComponent(msg)}`);
  }

  // Convert decimal USDC to atomic units (6 decimals)
  const amountAtomic = BigInt(Math.round(parseFloat(amountUsdc) * 1_000_000));

  const buyerWallet = getBuyerWalletClient();

  // Create escrow on-chain
  const tranche2Pct = 100 - tranche1Pct;
  const createHash = await buyerWallet.writeContract({
    address: FACTORY_ADDR,
    abi: EscrowFactoryAbi,
    functionName: 'createEscrow',
    args: [
      supplier.wallet_address as `0x${string}`,
      amountAtomic,
      [
        { milestoneType: BL_VERIFIED_TYPE, pct: BigInt(tranche1Pct) },
        { milestoneType: RECEIPT_CONFIRMED_TYPE, pct: BigInt(tranche2Pct) },
      ],
    ],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: createHash });

  // Parse escrowId and fee from EscrowCreated event
  const logs = parseEventLogs({
    abi: EscrowFactoryAbi,
    logs: receipt.logs,
    eventName: 'EscrowCreated',
  });
  const eventArgs = logs[0]?.args;
  if (!eventArgs) {
    redirect(`/transactions/new?error=${encodeURIComponent('Failed to parse escrow creation event')}`);
    return;
  }

  const escrowId = eventArgs.escrowId.toString();
  const feeAtomic = eventArgs.fee.toString();

  // Write to Supabase
  const { data: tx, error: txErr } = await db
    .from('transactions')
    .insert({
      escrow_id: escrowId,
      buyer_organization_id: profile.organization_id,
      supplier_id: supplierId,
      amount: amountAtomic.toString(),
      fee: feeAtomic,
      currency: 'USDC',
      state: 'Created',
      token_address: USDC_ADDR,
      escrow_address: ESCROW_ADDR,
      oracle_address: deployment.protocolConfig.oracle,
      arbitrator_address: deployment.protocolConfig.arbitrator,
      fx_rate_source_currency: 'MXN',
      fx_rate: '0.053',
      creation_tx_hash: createHash,
    })
    .select('id')
    .single();

  if (txErr || !tx) {
    redirect(`/transactions/new?error=${encodeURIComponent(txErr?.message ?? 'DB write failed')}`);
  }

  // Milestones
  await db.from('milestones').insert([
    {
      transaction_id: tx.id,
      index: 0,
      milestone_type: BL_VERIFIED_TYPE,
      pct: tranche1Pct,
      state: 'pending',
    },
    {
      transaction_id: tx.id,
      index: 1,
      milestone_type: RECEIPT_CONFIRMED_TYPE,
      pct: tranche2Pct,
      state: 'pending',
    },
  ]);

  // Audit event
  await db.from('audit_events').insert({
    transaction_id: tx.id,
    event_type: 'escrow_created',
    actor_address: buyerWallet.account.address,
    actor_user_id: user.id,
    onchain_tx_hash: createHash,
    block_number: receipt.blockNumber.toString(),
    data: { escrow_id: escrowId, amount: amountAtomic.toString(), fee: feeAtomic },
  });

  redirect(`/transactions/${tx.id}`);
}

export async function fundTransaction(formData: FormData) {
  const user = await getAuthUser();
  const txId = formData.get('transaction_id') as string;
  const db = getServiceClient();

  const { data: tx } = await db.from('transactions').select('*, supplier:suppliers(*)').eq('id', txId).single();
  if (!tx) redirect('/transactions');

  const profile = await getProfile(user.id);
  if (!profile) redirect('/onboard');

  // Sanctions check
  try {
    await runSanctionsCheck(
      profile.organization.name,
      profile.organization.wallet_address ?? '',
      profile.organization.country,
    );
    await runSanctionsCheck(
      tx.supplier.legal_name,
      tx.supplier.wallet_address,
      tx.supplier.registration_country,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    redirect(`/transactions/${txId}?error=${encodeURIComponent(msg)}`);
  }

  // total = amount + fee, matching exactly what fund() will transferFrom.
  // Use DB values (populated from the EscrowCreated event at creation) to avoid
  // an extra RPC round-trip and any potential struct-decoding edge case.
  const total = BigInt(tx.amount) + BigInt(tx.fee);
  const buyerWallet = getBuyerWalletClient();

  // Approve the Escrow contract to pull total USDC from the buyer wallet.
  const approveTx = await buyerWallet.writeContract({
    address: USDC_ADDR,
    abi: USDC_APPROVE_ABI,
    functionName: 'approve',
    args: [ESCROW_ADDR, total],
  });
  const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTx });
  if (approveReceipt.status !== 'success') {
    redirect(`/transactions/${txId}?error=${encodeURIComponent('USDC approve transaction reverted')}`);
  }

  // Fund escrow
  const fundTx = await buyerWallet.writeContract({
    address: ESCROW_ADDR,
    abi: EscrowAbi,
    functionName: 'fund',
    args: [BigInt(tx.escrow_id)],
  });
  const fundReceipt = await publicClient.waitForTransactionReceipt({ hash: fundTx });

  // Update DB
  await db
    .from('transactions')
    .update({
      state: 'Funded',
      funding_tx_hash: fundTx,
      funded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', txId);

  await db.from('audit_events').insert({
    transaction_id: txId,
    event_type: 'escrow_funded',
    actor_address: buyerWallet.account.address,
    actor_user_id: user.id,
    onchain_tx_hash: fundTx,
    block_number: fundReceipt.blockNumber.toString(),
    data: { amount: tx.amount, fee: tx.fee },
  });

  // Write sanctions-cleared audit event
  await db.from('audit_events').insert({
    transaction_id: txId,
    event_type: 'sanctions_screen_cleared',
    actor_user_id: user.id,
    data: { parties_screened: [profile.organization.name, tx.supplier.legal_name] },
  });

  redirect(`/transactions/${txId}`);
}

export async function confirmShipment(formData: FormData) {
  const user = await getAuthUser();
  const txId = formData.get('transaction_id') as string;
  const blText = formData.get('bl_reference') as string;

  if (!blText) {
    redirect(`/transactions/${txId}?error=${encodeURIComponent('B/L reference is required')}`);
  }

  const blRef = blTextToBytes32(blText);
  const db = getServiceClient();

  const { data: tx } = await db.from('transactions').select('escrow_id').eq('id', txId).single();
  if (!tx) redirect('/transactions');

  const supplierWallet = getSupplierWalletClient();

  const shipTx = await supplierWallet.writeContract({
    address: ESCROW_ADDR,
    abi: EscrowAbi,
    functionName: 'confirmShipment',
    args: [BigInt(tx.escrow_id), blRef],
  });
  const shipReceipt = await publicClient.waitForTransactionReceipt({ hash: shipTx });

  // Write bill of lading record
  await db.from('bills_of_lading').insert({
    transaction_id: txId,
    bl_reference: blRef,
    verification_state: 'pending',
  });

  // Update transaction state
  await db
    .from('transactions')
    .update({
      state: 'Shipped',
      shipped_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', txId);

  await db.from('audit_events').insert({
    transaction_id: txId,
    event_type: 'shipment_confirmed',
    actor_address: supplierWallet.account.address,
    actor_user_id: user.id,
    onchain_tx_hash: shipTx,
    block_number: shipReceipt.blockNumber.toString(),
    data: { bl_reference: blRef, bl_text: blText },
  });

  redirect(`/transactions/${txId}`);
}

export async function confirmReceipt(formData: FormData) {
  const user = await getAuthUser();
  const txId = formData.get('transaction_id') as string;
  const db = getServiceClient();

  const { data: tx } = await db.from('transactions').select('escrow_id, amount').eq('id', txId).single();
  if (!tx) redirect('/transactions');

  const buyerWallet = getBuyerWalletClient();

  const receiptTx = await buyerWallet.writeContract({
    address: ESCROW_ADDR,
    abi: EscrowAbi,
    functionName: 'confirmReceipt',
    args: [BigInt(tx.escrow_id)],
  });
  const receiptReceipt = await publicClient.waitForTransactionReceipt({ hash: receiptTx });

  const remaining = BigInt(tx.amount) - (BigInt(tx.amount) * 30n) / 100n; // tranche 2 (70%)

  // Update milestones
  await db
    .from('milestones')
    .update({ state: 'released', released_at: new Date().toISOString(), release_tx_hash: receiptTx })
    .eq('transaction_id', txId)
    .eq('index', 1);

  await db
    .from('transactions')
    .update({
      state: 'Completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', txId);

  await db.from('audit_events').insert({
    transaction_id: txId,
    event_type: 'receipt_confirmed',
    actor_address: buyerWallet.account.address,
    actor_user_id: user.id,
    onchain_tx_hash: receiptTx,
    block_number: receiptReceipt.blockNumber.toString(),
    data: { released_amount: remaining.toString() },
  });

  redirect(`/transactions/${txId}`);
}
