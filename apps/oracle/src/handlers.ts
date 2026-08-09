/**
 * Chain event handlers for the Puente indexer.
 *
 * Each exported function handles one Solidity event: it receives the decoded
 * event arguments plus block metadata, then performs the appropriate Supabase
 * writes (transactions, milestones, bills_of_lading, audit_events, ledger_entries).
 *
 * ── Webhook seam ──────────────────────────────────────────────────────────────
 * These handlers contain ALL of the indexer's business logic. They are
 * deliberately decoupled from the polling mechanics in indexer.ts. To replace
 * the polling loop with an Alchemy webhook or a subgraph subscription, parse the
 * incoming payload into the same event-arg shapes and call these same functions.
 * Nothing in this file imports from indexer.ts or depends on how events arrive.
 *
 * ── Idempotency ───────────────────────────────────────────────────────────────
 * Handlers use upsert (onConflict) for transactions and milestones, and
 * update-where-eq for state transitions — so replaying an already-processed
 * block produces no net change. audit_events rows accumulate on replay, which is
 * acceptable for Phase 1 (dedup can be added as a unique constraint later).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  EscrowAbi,
  type EscrowCreatedEvent,
  type EscrowFundedEvent,
  type ShipmentConfirmedEvent,
  type Tranche1ReleasedEvent,
  type FundsReleasedEvent,
  type ArrivalRecordedEvent,
  type DisputeRaisedEvent,
  type DisputeResolvedEvent,
} from '@puente/shared';
import { publicClient } from './chain';
import { deployment } from './config';
import {
  writeLedgerEntries,
  fundingLines,
  tranche1Lines,
  tranche2Lines,
  disputeResolutionLines,
} from './ledger';

// ── Shared types ──────────────────────────────────────────────────────────────

/** Metadata attached to every parsed log entry. */
export interface HandlerMeta {
  txHash: string;
  blockNumber: bigint;
  blockTimestamp: bigint;
  logIndex: number;
}

/** Decoded shape returned by Escrow.getEscrow(). */
interface OnchainEscrowRecord {
  buyer: string;
  supplier: string;
  amount: bigint;
  fee: bigint;
  feeRecipient: string;
  state: number;
  blReference: string;
  oracle: string;
  arbitrator: string;
  token: string;
  createdAt: bigint;
  fundedAt: bigint;
  shippedAt: bigint;
  completedAt: bigint;
  arrivalTimestamp: bigint;
  releasedAmount: bigint;
  milestones: ReadonlyArray<{ milestoneType: string; pct: bigint }>;
}

// ── Chain read helper ─────────────────────────────────────────────────────────

async function getEscrow(escrowId: bigint): Promise<OnchainEscrowRecord> {
  return publicClient.readContract({
    address: deployment.Escrow.address as `0x${string}`,
    abi: EscrowAbi,
    functionName: 'getEscrow',
    args: [escrowId],
  }) as Promise<OnchainEscrowRecord>;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

/**
 * Resolve a buyer wallet to its organization via the org_wallets registry.
 * Returns null when the wallet is not registered — the indexer NEVER invents a
 * placeholder organization. Attribution is left null until a wallet is
 * registered through onboarding or org settings.
 */
export async function lookupBuyerOrg(
  supabase: SupabaseClient,
  walletAddress: string,
): Promise<string | null> {
  const addr = walletAddress.toLowerCase();
  const { data } = await supabase
    .from('org_wallets')
    .select('organization_id')
    .eq('wallet_address', addr)
    .eq('role', 'buyer')
    .maybeSingle();
  return (data?.organization_id as string) ?? null;
}

/**
 * Resolve a supplier wallet to a suppliers row.
 *
 * Two gates:
 *   1. The wallet must be registered as a supplier in org_wallets.
 *   2. A suppliers row must exist for that wallet WITHIN the buyer's org
 *      (suppliers are per-buyer records).
 *
 * Returns null if either gate fails (including when the buyer org is unknown).
 */
export async function lookupSupplier(
  supabase: SupabaseClient,
  walletAddress: string,
  buyerOrgId: string | null,
): Promise<string | null> {
  if (!buyerOrgId) return null;
  const addr = walletAddress.toLowerCase();

  // Gate 1: wallet registered as a supplier at all?
  const { data: registered } = await supabase
    .from('org_wallets')
    .select('id')
    .eq('wallet_address', addr)
    .eq('role', 'supplier')
    .maybeSingle();
  if (!registered) return null;

  // Gate 2: a suppliers row for this wallet within the buyer's org.
  const { data: supplier } = await supabase
    .from('suppliers')
    .select('id')
    .ilike('wallet_address', addr)
    .eq('buyer_organization_id', buyerOrgId)
    .limit(1)
    .maybeSingle();
  return (supplier?.id as string) ?? null;
}

async function findTransactionId(
  supabase: SupabaseClient,
  escrowId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('transactions')
    .select('id')
    .eq('escrow_id', escrowId)
    .maybeSingle();
  return (data?.id as string) ?? null;
}

async function appendAudit(
  supabase: SupabaseClient,
  p: {
    transactionId: string | null;
    eventType: string;
    actorAddress?: string;
    txHash: string;
    blockNumber: bigint;
    data?: Record<string, unknown>;
    occurredAt: string;
  },
): Promise<void> {
  const { error } = await supabase.from('audit_events').insert({
    transaction_id:  p.transactionId,
    event_type:      p.eventType,
    actor_address:   p.actorAddress,
    onchain_tx_hash: p.txHash,
    block_number:    p.blockNumber.toString(),
    data:            p.data ?? {},
    occurred_at:     p.occurredAt,
  });
  if (error) throw new Error(`[handlers] audit_events insert: ${error.message}`);
}

function tsToISO(unixSec: bigint): string {
  return new Date(Number(unixSec) * 1000).toISOString();
}

// ── Event handlers ────────────────────────────────────────────────────────────

export async function handleEscrowCreated(
  supabase: SupabaseClient,
  event: EscrowCreatedEvent,
  meta: HandlerMeta,
): Promise<void> {
  const record      = await getEscrow(event.escrowId);
  const escrowIdStr = event.escrowId.toString();
  const occurredAt  = tsToISO(meta.blockTimestamp);

  // Attribute buyer/supplier via the org_wallets registry. Unregistered wallets
  // yield null attribution and a warning — no placeholder orgs are ever created.
  const buyerOrgId = await lookupBuyerOrg(supabase, event.buyer);
  if (!buyerOrgId) {
    console.warn(
      `[handlers] EscrowCreated ${escrowIdStr}: buyer wallet ${event.buyer.toLowerCase()} ` +
        `is not registered in org_wallets — recording transaction with buyer_organization_id=null.`,
    );
  }

  const supplierId = await lookupSupplier(supabase, event.supplier, buyerOrgId);
  if (!supplierId) {
    console.warn(
      `[handlers] EscrowCreated ${escrowIdStr}: supplier wallet ${event.supplier.toLowerCase()} ` +
        `did not resolve to a suppliers row for the buyer org — recording transaction with supplier_id=null.`,
    );
  }

  const { data: txRow, error: txErr } = await supabase
    .from('transactions')
    .upsert(
      {
        escrow_id:             escrowIdStr,
        buyer_organization_id: buyerOrgId,
        supplier_id:           supplierId,
        amount:                record.amount.toString(),
        fee:                   record.fee.toString(),
        currency:              'USDC',
        state:                 'Created',
        token_address:         record.token.toLowerCase(),
        escrow_address:        deployment.Escrow.address.toLowerCase(),
        oracle_address:        record.oracle.toLowerCase(),
        arbitrator_address:    record.arbitrator.toLowerCase(),
        creation_tx_hash:      meta.txHash,
        created_at:            occurredAt,
        updated_at:            occurredAt,
      },
      { onConflict: 'escrow_id' },
    )
    .select('id')
    .single();

  if (txErr || !txRow) throw new Error(`[handlers] transaction upsert: ${txErr?.message}`);
  const txId = txRow.id as string;

  // Upsert milestones (idempotent on (transaction_id, index))
  for (let i = 0; i < record.milestones.length; i++) {
    const m = record.milestones[i];
    const { error } = await supabase
      .from('milestones')
      .upsert(
        { transaction_id: txId, index: i, milestone_type: m.milestoneType, pct: Number(m.pct), state: 'pending' },
        { onConflict: 'transaction_id,index' },
      );
    if (error) throw new Error(`[handlers] milestones upsert: ${error.message}`);
  }

  await appendAudit(supabase, {
    transactionId: txId,
    eventType:     'escrow_created',
    actorAddress:  event.buyer.toLowerCase(),
    txHash:        meta.txHash,
    blockNumber:   meta.blockNumber,
    data:          { escrowId: escrowIdStr, amount: record.amount.toString(), fee: record.fee.toString() },
    occurredAt,
  });
  // No ledger entries: no funds moved at creation.
}

export async function handleEscrowFunded(
  supabase: SupabaseClient,
  event: EscrowFundedEvent,
  meta: HandlerMeta,
): Promise<void> {
  const escrowIdStr = event.escrowId.toString();
  const occurredAt  = tsToISO(meta.blockTimestamp);

  const { error } = await supabase
    .from('transactions')
    .update({ state: 'Funded', funding_tx_hash: meta.txHash, funded_at: occurredAt, updated_at: occurredAt })
    .eq('escrow_id', escrowIdStr);
  if (error) throw new Error(`[handlers] transaction update (Funded): ${error.message}`);

  const txId = await findTransactionId(supabase, escrowIdStr);
  if (!txId) return;

  await appendAudit(supabase, {
    transactionId: txId,
    eventType:     'escrow_funded',
    actorAddress:  event.buyer.toLowerCase(),
    txHash:        meta.txHash,
    blockNumber:   meta.blockNumber,
    data:          { escrowId: escrowIdStr, amount: event.amount.toString(), fee: event.fee.toString() },
    occurredAt,
  });

  // Ledger: buyer pays amount + fee; fee captured immediately by feeRecipient.
  const record = await getEscrow(event.escrowId);
  await writeLedgerEntries({
    supabase,
    transactionId:   txId,
    onchainEventRef: meta.txHash,
    occurredAt,
    lines: fundingLines({
      escrowId:            escrowIdStr,
      buyerAddress:        event.buyer,
      feeRecipientAddress: record.feeRecipient,
      amount:              event.amount,
      fee:                 event.fee,
    }),
  });
}

export async function handleShipmentConfirmed(
  supabase: SupabaseClient,
  event: ShipmentConfirmedEvent,
  meta: HandlerMeta,
): Promise<void> {
  const escrowIdStr = event.escrowId.toString();
  const occurredAt  = tsToISO(meta.blockTimestamp);

  await supabase
    .from('transactions')
    .update({ state: 'Shipped', shipped_at: occurredAt, updated_at: occurredAt })
    .eq('escrow_id', escrowIdStr);

  const txId = await findTransactionId(supabase, escrowIdStr);
  if (!txId) return;

  // Upsert B/L record (one per transaction in Phase 1)
  const { data: existingBol } = await supabase
    .from('bills_of_lading')
    .select('id')
    .eq('transaction_id', txId)
    .maybeSingle();

  if (existingBol?.id) {
    await supabase
      .from('bills_of_lading')
      .update({ bl_reference: event.blReference, verification_state: 'pending' })
      .eq('id', existingBol.id);
  } else {
    const { error } = await supabase.from('bills_of_lading').insert({
      transaction_id:     txId,
      bl_reference:       event.blReference,
      verification_state: 'pending',
      uploaded_at:        occurredAt,
    });
    if (error) throw new Error(`[handlers] bills_of_lading insert: ${error.message}`);
  }

  await appendAudit(supabase, {
    transactionId: txId,
    eventType:     'shipment_confirmed',
    actorAddress:  event.supplier.toLowerCase(),
    txHash:        meta.txHash,
    blockNumber:   meta.blockNumber,
    data:          { escrowId: escrowIdStr, blReference: event.blReference },
    occurredAt,
  });
  // No ledger entries: no funds moved.
}

export async function handleTranche1Released(
  supabase: SupabaseClient,
  event: Tranche1ReleasedEvent,
  meta: HandlerMeta,
): Promise<void> {
  const escrowIdStr = event.escrowId.toString();
  const occurredAt  = tsToISO(meta.blockTimestamp);

  await supabase
    .from('transactions')
    .update({ state: 'PartialReleased', partial_released_at: occurredAt, updated_at: occurredAt })
    .eq('escrow_id', escrowIdStr);

  const txId = await findTransactionId(supabase, escrowIdStr);
  if (!txId) return;

  // Mark milestone index 0 (BL_VERIFIED) as released.
  await supabase
    .from('milestones')
    .update({ state: 'released', released_amount: event.amount.toString(), release_tx_hash: meta.txHash, released_at: occurredAt })
    .eq('transaction_id', txId)
    .eq('index', 0);

  // Mark the B/L as verified.
  await supabase
    .from('bills_of_lading')
    .update({ verification_state: 'verified', verification_tx_hash: meta.txHash, verified_at: occurredAt })
    .eq('transaction_id', txId);

  await appendAudit(supabase, {
    transactionId: txId,
    eventType:     'tranche1_released',
    actorAddress:  event.supplier.toLowerCase(),
    txHash:        meta.txHash,
    blockNumber:   meta.blockNumber,
    data:          { escrowId: escrowIdStr, amount: event.amount.toString() },
    occurredAt,
  });

  // Ledger: escrow releases tranche 1 to supplier.
  await writeLedgerEntries({
    supabase,
    transactionId:   txId,
    onchainEventRef: meta.txHash,
    occurredAt,
    lines: tranche1Lines({ escrowId: escrowIdStr, supplierAddress: event.supplier, amount: event.amount }),
  });
}

export async function handleFundsReleased(
  supabase: SupabaseClient,
  event: FundsReleasedEvent,
  meta: HandlerMeta,
): Promise<void> {
  const escrowIdStr = event.escrowId.toString();
  const occurredAt  = tsToISO(meta.blockTimestamp);

  await supabase
    .from('transactions')
    .update({ state: 'Completed', completed_at: occurredAt, updated_at: occurredAt })
    .eq('escrow_id', escrowIdStr);

  const txId = await findTransactionId(supabase, escrowIdStr);
  if (!txId) return;

  // Mark milestone index 1 (RECEIPT_CONFIRMED) as released.
  await supabase
    .from('milestones')
    .update({ state: 'released', released_amount: event.amount.toString(), release_tx_hash: meta.txHash, released_at: occurredAt })
    .eq('transaction_id', txId)
    .eq('index', 1);

  await appendAudit(supabase, {
    transactionId: txId,
    eventType:     'funds_released',
    actorAddress:  event.supplier.toLowerCase(),
    txHash:        meta.txHash,
    blockNumber:   meta.blockNumber,
    data:          { escrowId: escrowIdStr, amount: event.amount.toString() },
    occurredAt,
  });

  // Ledger: escrow releases tranche 2 to supplier.
  await writeLedgerEntries({
    supabase,
    transactionId:   txId,
    onchainEventRef: meta.txHash,
    occurredAt,
    lines: tranche2Lines({ escrowId: escrowIdStr, supplierAddress: event.supplier, amount: event.amount }),
  });
}

export async function handleArrivalRecorded(
  supabase: SupabaseClient,
  event: ArrivalRecordedEvent,
  meta: HandlerMeta,
): Promise<void> {
  const escrowIdStr = event.escrowId.toString();
  const occurredAt  = tsToISO(meta.blockTimestamp);

  const txId = await findTransactionId(supabase, escrowIdStr);
  if (!txId) return;

  await supabase
    .from('bills_of_lading')
    .update({ arrival_timestamp: Number(event.arrivalTimestamp) })
    .eq('transaction_id', txId);

  await appendAudit(supabase, {
    transactionId: txId,
    eventType:     'arrival_recorded',
    txHash:        meta.txHash,
    blockNumber:   meta.blockNumber,
    data:          { escrowId: escrowIdStr, arrivalTimestamp: event.arrivalTimestamp.toString() },
    occurredAt,
  });
  // No funds moved.
}

export async function handleDisputeRaised(
  supabase: SupabaseClient,
  event: DisputeRaisedEvent,
  meta: HandlerMeta,
): Promise<void> {
  const escrowIdStr = event.escrowId.toString();
  const occurredAt  = tsToISO(meta.blockTimestamp);

  await supabase
    .from('transactions')
    .update({ state: 'Disputed', updated_at: occurredAt })
    .eq('escrow_id', escrowIdStr);

  const txId = await findTransactionId(supabase, escrowIdStr);
  if (!txId) return;

  await appendAudit(supabase, {
    transactionId: txId,
    eventType:     'dispute_raised',
    actorAddress:  event.buyer.toLowerCase(),
    txHash:        meta.txHash,
    blockNumber:   meta.blockNumber,
    data:          { escrowId: escrowIdStr, buyer: event.buyer },
    occurredAt,
  });
  // No funds moved: funds are frozen but not transferred.
}

export async function handleDisputeResolved(
  supabase: SupabaseClient,
  event: DisputeResolvedEvent,
  meta: HandlerMeta,
): Promise<void> {
  const escrowIdStr = event.escrowId.toString();
  const occurredAt  = tsToISO(meta.blockTimestamp);

  await supabase
    .from('transactions')
    .update({ state: 'Resolved', updated_at: occurredAt })
    .eq('escrow_id', escrowIdStr);

  const txId = await findTransactionId(supabase, escrowIdStr);
  if (!txId) return;

  // Update the dispute record if it was created through the web app.
  await supabase
    .from('disputes')
    .update({
      state:              'resolved',
      buyer_split:        event.buyerAmount.toString(),
      supplier_split:     event.supplierAmount.toString(),
      resolution_tx_hash: meta.txHash,
      resolved_at:        occurredAt,
    })
    .eq('transaction_id', txId);

  await appendAudit(supabase, {
    transactionId: txId,
    eventType:     'dispute_resolved',
    actorAddress:  event.arbitrator.toLowerCase(),
    txHash:        meta.txHash,
    blockNumber:   meta.blockNumber,
    data: {
      escrowId:       escrowIdStr,
      buyerAmount:    event.buyerAmount.toString(),
      supplierAmount: event.supplierAmount.toString(),
    },
    occurredAt,
  });

  // Ledger: escrow releases to buyer and/or supplier per arbitrator decision.
  // Read buyer/supplier addresses from the on-chain record (source of truth).
  const record = await getEscrow(event.escrowId);
  await writeLedgerEntries({
    supabase,
    transactionId:   txId,
    onchainEventRef: meta.txHash,
    occurredAt,
    lines: disputeResolutionLines({
      escrowId:        escrowIdStr,
      buyerAddress:    record.buyer,
      supplierAddress: record.supplier,
      buyerAmount:     event.buyerAmount,
      supplierAmount:  event.supplierAmount,
    }),
  });
}
