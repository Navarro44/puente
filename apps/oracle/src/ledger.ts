/**
 * Double-entry ledger writer for the Puente chain indexer.
 *
 * Chart of accounts
 * ─────────────────
 *   buyer:<address>          — buyer's economic position (debit = outflow from buyer)
 *   escrow:<escrowId>        — funds currently held by the escrow contract
 *   supplier:<address>       — supplier's economic position (credit = inflow to supplier)
 *   protocol_fee:<address>   — protocol fee revenue account
 *
 * Invariant: for every group written together (same on-chain event), the sum of
 * all debits equals the sum of all credits. This is asserted in code before each
 * write. The DB schema does not enforce the invariant, but failing tests will catch
 * a regression.
 *
 * The ledger records what happened on-chain. It never authorises a movement.
 * The chain is always the source of truth for funds.
 *
 * Fund-affecting event mapping:
 *
 *   EscrowFunded (buyer funds escrow + fee captured immediately):
 *     DR buyer:<buyer>                     amount + fee
 *     CR escrow:<escrowId>                 amount
 *     CR protocol_fee:<feeRecipient>       fee
 *
 *   Tranche1Released (oracle verifies B/L; tranche 1 → supplier):
 *     DR escrow:<escrowId>                 tranche1Amount
 *     CR supplier:<supplier>               tranche1Amount
 *
 *   FundsReleased (receipt confirmed or timeout; tranche 2 → supplier):
 *     DR escrow:<escrowId>                 tranche2Amount
 *     CR supplier:<supplier>               tranche2Amount
 *
 *   DisputeResolved (arbitrator splits remaining funds):
 *     DR escrow:<escrowId>                 buyerAmount + supplierAmount
 *     CR buyer:<buyer>                     buyerAmount   (if > 0)
 *     CR supplier:<supplier>               supplierAmount (if > 0)
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface LedgerLine {
  account: string;
  /** Exactly one of debit/credit is > 0n; the other must be 0n. */
  debit: bigint;
  credit: bigint;
}

interface WriteParams {
  supabase: SupabaseClient;
  transactionId: string;    // DB UUID of the transaction row
  onchainEventRef: string;  // on-chain tx hash of the originating event
  occurredAt: string;       // ISO 8601 timestamp
  lines: LedgerLine[];
}

export async function writeLedgerEntries(params: WriteParams): Promise<void> {
  const { supabase, transactionId, onchainEventRef, occurredAt, lines } = params;

  const totalDebit  = lines.reduce((s, l) => s + l.debit,  0n);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0n);
  if (totalDebit !== totalCredit) {
    throw new Error(
      `[ledger] Imbalance on event ${onchainEventRef}: ` +
        `debit=${totalDebit} credit=${totalCredit} — aborting write`,
    );
  }

  const rows = lines.map((l) => ({
    transaction_id:    transactionId,
    account:           l.account,
    debit:             l.debit.toString(),
    credit:            l.credit.toString(),
    currency:          'USDC',
    onchain_event_ref: onchainEventRef,
    occurred_at:       occurredAt,
  }));

  const { error } = await supabase.from('ledger_entries').insert(rows);
  if (error) throw new Error(`[ledger] Insert failed: ${error.message}`);
}

// ── Per-event line builders ───────────────────────────────────────────────────

export function fundingLines(p: {
  escrowId: string;
  buyerAddress: string;
  feeRecipientAddress: string;
  amount: bigint;
  fee: bigint;
}): LedgerLine[] {
  return [
    { account: `buyer:${p.buyerAddress.toLowerCase()}`,               debit: p.amount + p.fee, credit: 0n },
    { account: `escrow:${p.escrowId}`,                                 debit: 0n, credit: p.amount },
    { account: `protocol_fee:${p.feeRecipientAddress.toLowerCase()}`,  debit: 0n, credit: p.fee },
  ];
}

export function tranche1Lines(p: {
  escrowId: string;
  supplierAddress: string;
  amount: bigint;
}): LedgerLine[] {
  return [
    { account: `escrow:${p.escrowId}`,                            debit: p.amount, credit: 0n },
    { account: `supplier:${p.supplierAddress.toLowerCase()}`,     debit: 0n,       credit: p.amount },
  ];
}

export function tranche2Lines(p: {
  escrowId: string;
  supplierAddress: string;
  amount: bigint;
}): LedgerLine[] {
  return [
    { account: `escrow:${p.escrowId}`,                            debit: p.amount, credit: 0n },
    { account: `supplier:${p.supplierAddress.toLowerCase()}`,     debit: 0n,       credit: p.amount },
  ];
}

export function disputeResolutionLines(p: {
  escrowId: string;
  buyerAddress: string;
  supplierAddress: string;
  buyerAmount: bigint;
  supplierAmount: bigint;
}): LedgerLine[] {
  const total = p.buyerAmount + p.supplierAmount;
  const lines: LedgerLine[] = [
    { account: `escrow:${p.escrowId}`, debit: total, credit: 0n },
  ];
  if (p.buyerAmount > 0n) {
    lines.push({ account: `buyer:${p.buyerAddress.toLowerCase()}`,    debit: 0n, credit: p.buyerAmount });
  }
  if (p.supplierAmount > 0n) {
    lines.push({ account: `supplier:${p.supplierAddress.toLowerCase()}`, debit: 0n, credit: p.supplierAmount });
  }
  return lines;
}
