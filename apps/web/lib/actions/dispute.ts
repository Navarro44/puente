'use server';

import { redirect } from 'next/navigation';
import { EscrowAbi } from '@puente/shared';
import { createSupabaseServerClient } from '../supabase/server';
import { getServiceClient } from '../supabase/service';
import { publicClient, getBuyerWalletClient, getArbitratorWalletClient } from '../chain';
import { deployment } from '../deployments';

const ESCROW_ADDR = deployment.Escrow.address as `0x${string}`;

async function getAuthUser() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  return user;
}

export async function raiseDispute(formData: FormData) {
  const user = await getAuthUser();
  const txId = formData.get('transaction_id') as string;
  const reason = (formData.get('reason') as string) || '';
  const db = getServiceClient();

  const { data: tx } = await db.from('transactions').select('escrow_id').eq('id', txId).single();
  if (!tx) redirect('/transactions');

  const buyerWallet = getBuyerWalletClient();

  const disputeTx = await buyerWallet.writeContract({
    address: ESCROW_ADDR,
    abi: EscrowAbi,
    functionName: 'raiseDispute',
    args: [BigInt(tx.escrow_id)],
  });
  const disputeReceipt = await publicClient.waitForTransactionReceipt({ hash: disputeTx });

  // Create dispute record
  await db.from('disputes').insert({
    transaction_id: txId,
    raised_by_user_id: user.id,
    state: 'open',
    reason,
  });

  await db
    .from('transactions')
    .update({ state: 'Disputed', updated_at: new Date().toISOString() })
    .eq('id', txId);

  await db.from('audit_events').insert({
    transaction_id: txId,
    event_type: 'dispute_raised',
    actor_address: buyerWallet.account.address,
    actor_user_id: user.id,
    onchain_tx_hash: disputeTx,
    block_number: disputeReceipt.blockNumber.toString(),
    data: { reason },
  });

  redirect(`/transactions/${txId}`);
}

export async function resolveDispute(formData: FormData) {
  const user = await getAuthUser();
  const txId = formData.get('transaction_id') as string;
  const disputeId = formData.get('dispute_id') as string;
  const buyerSplitUsdc = formData.get('buyer_split_usdc') as string;
  const supplierSplitUsdc = formData.get('supplier_split_usdc') as string;

  const db = getServiceClient();
  const { data: tx } = await db.from('transactions').select('escrow_id, amount').eq('id', txId).single();
  if (!tx) redirect('/transactions');

  // Convert decimal USDC to atomic
  const buyerSplit = BigInt(Math.round(parseFloat(buyerSplitUsdc) * 1_000_000));
  const supplierSplit = BigInt(Math.round(parseFloat(supplierSplitUsdc) * 1_000_000));

  const arbitratorWallet = getArbitratorWalletClient();

  const resolveTx = await arbitratorWallet.writeContract({
    address: ESCROW_ADDR,
    abi: EscrowAbi,
    functionName: 'resolveDispute',
    args: [BigInt(tx.escrow_id), buyerSplit, supplierSplit],
  });
  const resolveReceipt = await publicClient.waitForTransactionReceipt({ hash: resolveTx });

  await db
    .from('disputes')
    .update({
      state: 'resolved',
      buyer_split: buyerSplit.toString(),
      supplier_split: supplierSplit.toString(),
      resolution_tx_hash: resolveTx,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', disputeId);

  await db
    .from('transactions')
    .update({ state: 'Resolved', updated_at: new Date().toISOString() })
    .eq('id', txId);

  await db.from('audit_events').insert({
    transaction_id: txId,
    event_type: 'dispute_resolved',
    actor_address: arbitratorWallet.account.address,
    actor_user_id: user.id,
    onchain_tx_hash: resolveTx,
    block_number: resolveReceipt.blockNumber.toString(),
    data: {
      buyer_split: buyerSplit.toString(),
      supplier_split: supplierSplit.toString(),
    },
  });

  redirect(`/transactions/${txId}`);
}
