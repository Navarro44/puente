/**
 * Oracle worker — standalone process.
 *
 * Responsibilities:
 *   1. Poll Supabase for transactions in Shipped state with a pending B/L.
 *   2. Call the CarrierApiAdapter to verify the B/L (shipper/consignee/in-transit).
 *   3. On successful verification, submit verifyBL() to the Escrow contract,
 *      triggering the 30% tranche-1 partial release.
 *   4. Poll PartialReleased transactions; when the carrier reports arrival,
 *      submit recordArrival() on-chain, starting the 14-day buyer-confirm timeout.
 *
 * Phase 1: the CarrierApiAdapter is SupabaseMockCarrierAdapter. An operator
 * runs `pnpm --filter oracle arm:bl <blRef>` to persist a verification result
 * to Supabase. The oracle reads from that table on every poll cycle — no
 * shared in-memory state is required between processes. The interface is
 * identical to the real Phase 2 adapter, so the swap is transparent.
 *
 * Safety guarantees:
 *   - In-flight set: escrowIds being processed are tracked to prevent concurrent
 *     submissions for the same escrow within one process lifetime.
 *   - On-chain state check: before submitting any tx, the oracle reads the current
 *     on-chain state. If the escrow has already advanced past the expected state,
 *     the submission is silently skipped (idempotency across restarts).
 *   - Retry with backoff: transient RPC failures retry up to MAX_RETRIES times
 *     with exponential backoff; permanent failures are logged and skipped.
 *   - An adapter failure (carrier API down) never crashes the worker and never
 *     causes a double-submit; it simply defers the escrow to the next cycle.
 *   - The signing key is never logged or included in any error message.
 *
 * Run standalone:  node dist/oracle.js   (or  ts-node src/oracle.ts)
 */

import { EscrowAbi, EscrowState } from '@puente/shared';
import { publicClient, walletClient, oracleAddress } from './chain';
import { supabase } from './db';
import { deployment, ORACLE_POLL_MS } from './config';
import { SupabaseMockCarrierAdapter } from './carrier';

// Carrier adapter backed by Supabase so arm-bl.ts can write verifications
// from a separate process without any shared in-memory state.
const carrierAdapter = new SupabaseMockCarrierAdapter(supabase);

const ESCROW_ADDR = deployment.Escrow.address as `0x${string}`;

// ── Retry helper ──────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      const delayMs = Math.min(1_000 * 2 ** attempt, 30_000);
      console.warn(`[oracle] ${label}: attempt ${attempt} failed, retrying in ${delayMs} ms`, err);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('unreachable');
}

// ── On-chain state guard ──────────────────────────────────────────────────────

async function getOnchainState(escrowId: bigint): Promise<EscrowState> {
  const state = await publicClient.readContract({
    address: ESCROW_ADDR,
    abi:     EscrowAbi,
    functionName: 'getState',
    args:    [escrowId],
  });
  return state as EscrowState;
}

async function getOnchainArrivalTimestamp(escrowId: bigint): Promise<bigint> {
  const record = await publicClient.readContract({
    address: ESCROW_ADDR,
    abi:     EscrowAbi,
    functionName: 'getEscrow',
    args:    [escrowId],
  }) as { arrivalTimestamp: bigint };
  return record.arrivalTimestamp;
}

// ── In-flight tracking ────────────────────────────────────────────────────────

const inFlight = new Set<string>(); // escrowIds currently being submitted

// ── B/L verification and verifyBL submission ──────────────────────────────────

async function processShipment(
  escrowId: string,
  blRef: string,
): Promise<void> {
  // Guard: check on-chain state before submitting.
  const state = await getOnchainState(BigInt(escrowId));
  if (state !== EscrowState.Shipped) {
    console.log(`[oracle] escrow ${escrowId} is no longer Shipped (state=${state}), skipping`);
    return;
  }

  const verification = await carrierAdapter.verifyBillOfLading(blRef);
  if (!verification.valid) {
    console.log(`[oracle] escrow ${escrowId}: B/L ${blRef} not yet verified by carrier`);
    return;
  }
  if (!verification.inTransit) {
    console.log(`[oracle] escrow ${escrowId}: B/L ${blRef} is valid but not in transit yet`);
    return;
  }

  console.log(
    `[oracle] escrow ${escrowId}: B/L verified (shipper="${verification.shipper}", ` +
      `consignee="${verification.consignee}"). Submitting verifyBL…`,
  );

  await withRetry(`verifyBL(${escrowId})`, async () => {
    const hash = await walletClient.writeContract({
      address:      ESCROW_ADDR,
      abi:          EscrowAbi,
      functionName: 'verifyBL',
      args:         [BigInt(escrowId), blRef as `0x${string}`],
    });
    console.log(`[oracle] verifyBL submitted for escrow ${escrowId} (tx: ${hash})`);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`[oracle] verifyBL confirmed for escrow ${escrowId}`);
  });
}

async function pollShipped(): Promise<void> {
  const { data: rows, error } = await supabase
    .from('transactions')
    .select('id, escrow_id')
    .eq('state', 'Shipped');

  if (error) { console.error('[oracle] pollShipped query error:', error.message); return; }

  for (const row of rows ?? []) {
    if (inFlight.has(row.escrow_id)) continue;

    const { data: bol } = await supabase
      .from('bills_of_lading')
      .select('bl_reference, verification_state')
      .eq('transaction_id', row.id)
      .eq('verification_state', 'pending')
      .maybeSingle();

    if (!bol) continue;

    inFlight.add(row.escrow_id);
    processShipment(row.escrow_id, bol.bl_reference)
      .catch((err) => console.error(`[oracle] processShipment(${row.escrow_id}) failed:`, err))
      .finally(() => inFlight.delete(row.escrow_id));
  }
}

// ── Arrival polling and recordArrival submission ──────────────────────────────

async function processArrival(escrowId: string, blRef: string): Promise<void> {
  // Guard: arrival already recorded on-chain?
  const arrivalTs = await getOnchainArrivalTimestamp(BigInt(escrowId));
  if (arrivalTs > 0n) {
    console.log(`[oracle] escrow ${escrowId}: arrival already recorded on-chain, skipping`);
    return;
  }

  const arrival = await carrierAdapter.getArrival(blRef);
  if (!arrival) return; // not yet arrived

  console.log(
    `[oracle] escrow ${escrowId}: carrier reports arrival at ${arrival.portOfDischarge} ` +
      `(ts=${arrival.arrivalTimestamp}). Submitting recordArrival…`,
  );

  await withRetry(`recordArrival(${escrowId})`, async () => {
    const hash = await walletClient.writeContract({
      address:      ESCROW_ADDR,
      abi:          EscrowAbi,
      functionName: 'recordArrival',
      args:         [BigInt(escrowId)],
    });
    console.log(`[oracle] recordArrival submitted for escrow ${escrowId} (tx: ${hash})`);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`[oracle] recordArrival confirmed for escrow ${escrowId}`);
  });
}

async function pollPartialReleased(): Promise<void> {
  const { data: rows, error } = await supabase
    .from('transactions')
    .select('id, escrow_id')
    .eq('state', 'PartialReleased');

  if (error) { console.error('[oracle] pollPartialReleased query error:', error.message); return; }

  for (const row of rows ?? []) {
    if (inFlight.has(row.escrow_id)) continue;

    // Get the B/L reference and check if arrival is already recorded in DB.
    const { data: bol } = await supabase
      .from('bills_of_lading')
      .select('bl_reference, arrival_timestamp')
      .eq('transaction_id', row.id)
      .maybeSingle();

    if (!bol || bol.arrival_timestamp) continue; // not found or already recorded

    inFlight.add(row.escrow_id);
    processArrival(row.escrow_id, bol.bl_reference)
      .catch((err) => console.error(`[oracle] processArrival(${row.escrow_id}) failed:`, err))
      .finally(() => inFlight.delete(row.escrow_id));
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

export async function startOracle(): Promise<void> {
  console.log(`[oracle] Starting. Oracle address: ${oracleAddress}`);
  console.log(`[oracle] Network: ${deployment.network} (chainId ${deployment.chainId})`);
  console.log(`[oracle] Escrow: ${ESCROW_ADDR}`);
  console.log(`[oracle] Poll interval: ${ORACLE_POLL_MS} ms`);

  const runCycle = async (): Promise<void> => {
    try {
      await pollShipped();
      await pollPartialReleased();
    } catch (err) {
      console.error('[oracle] Cycle error:', err);
    }
  };

  await runCycle();
  const interval = setInterval(runCycle, ORACLE_POLL_MS);

  const shutdown = (): void => {
    console.log('[oracle] Shutting down…');
    clearInterval(interval);
    process.exit(0);
  };
  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);
}

// Run standalone when executed directly.
if (require.main === module) {
  startOracle().catch((err) => {
    console.error('[oracle] Fatal:', err);
    process.exit(1);
  });
}
