/**
 * Chain indexer — standalone process.
 *
 * Polls EscrowFactory and Escrow for new events on each cycle and writes
 * state changes to Supabase (transactions, milestones, bills_of_lading,
 * audit_events, ledger_entries).
 *
 * ── Why polling (Phase 1)? ────────────────────────────────────────────────────
 * Polling requires no webhook infrastructure, no public IP, no ngrok tunnel,
 * and no Alchemy subscription. It runs identically in local dev, CI, and
 * a simple VPS. The max latency is one poll interval (default 15 s), which is
 * acceptable for the MVP trade finance flow.
 *
 * ── Webhook adapter seam ──────────────────────────────────────────────────────
 * All business logic lives in handlers.ts. The polling loop below is a thin
 * event-feed layer: it fetches raw logs, decodes them with viem's
 * parseEventLogs, and calls the same handler functions that a webhook listener
 * would call. Replacing this file with a webhook adapter requires no changes
 * to handlers.ts.
 *
 * ── Chunk size and Alchemy free-tier ─────────────────────────────────────────
 * eth_getLogs on the Alchemy free tier is capped at 10 blocks per call.
 * LOG_CHUNK_SIZE (env: INDEXER_LOG_CHUNK_SIZE, default 10) controls this.
 *
 * Pacing: CALL_DELAY_MS (env: INDEXER_CALL_DELAY_MS, default 200 ms) is
 * awaited after every successful chunk to avoid saturating the free-tier
 * compute-unit budget. Increase this if 429s persist; set to 0 on a paid plan.
 *
 * Retry: each chunk retries up to 6 times with exponential backoff starting at
 * 2 s, capped at 60 s. 429 responses are always retried; they are never treated
 * as an early-exit signal. If all 6 attempts fail the indexer does NOT crash —
 * it logs the failure to stderr, sleeps 60 s, and retries the same chunk from
 * scratch. The cursor only advances on success, so no blocks are skipped.
 *
 * ── Backfill and idempotency ──────────────────────────────────────────────────
 * The last fully-processed block is persisted to the Supabase indexer_state
 * table (one row per network, keyed by network name). On startup the indexer
 * reads that value and replays from that block forward, ensuring no events are
 * skipped after a restart. Handlers use upsert/update-where so replaying an
 * already-processed block produces no net DB change.
 *
 * Run standalone:  node dist/indexer.js   (or  ts-node src/indexer.ts)
 */

import { parseEventLogs } from 'viem';
import type { Log } from 'viem';
import {
  EscrowAbi,
  EscrowFactoryAbi,
  type EscrowCreatedEvent,
  type EscrowFundedEvent,
  type ShipmentConfirmedEvent,
  type Tranche1ReleasedEvent,
  type FundsReleasedEvent,
  type ArrivalRecordedEvent,
  type DisputeRaisedEvent,
  type DisputeResolvedEvent,
} from '@puente/shared';
import { publicClient, oracleAddress } from './chain';
import { supabase } from './db';
import { deployment, INDEXER_POLL_MS, LOG_CHUNK_SIZE, CALL_DELAY_MS, NETWORK } from './config';
import {
  handleEscrowCreated,
  handleEscrowFunded,
  handleShipmentConfirmed,
  handleTranche1Released,
  handleFundsReleased,
  handleArrivalRecorded,
  handleDisputeRaised,
  handleDisputeResolved,
  type HandlerMeta,
} from './handlers';

// ── Cursor persistence (Supabase) ─────────────────────────────────────────────

async function readCursor(): Promise<bigint> {
  const { data, error } = await supabase
    .from('indexer_state')
    .select('last_processed_block')
    .eq('network', NETWORK)
    .maybeSingle();

  if (error) {
    console.warn('[indexer] Could not read cursor from Supabase, starting from deployment block:', error.message);
    return BigInt(deployment.deploymentBlock);
  }
  if (!data) return BigInt(deployment.deploymentBlock);
  return BigInt(data.last_processed_block);
}

async function writeCursor(blockNumber: bigint): Promise<void> {
  const { error } = await supabase
    .from('indexer_state')
    .upsert(
      { network: NETWORK, last_processed_block: Number(blockNumber), updated_at: new Date().toISOString() },
      { onConflict: 'network' },
    );
  if (error) {
    // Log but don't throw — a cursor write failure is recoverable on the next successful chunk.
    console.warn('[indexer] Failed to persist cursor to Supabase:', error.message);
  }
}

// ── Block timestamp cache ─────────────────────────────────────────────────────

const blockTimestampCache = new Map<bigint, bigint>();

async function getBlockTimestamp(blockNumber: bigint): Promise<bigint> {
  const cached = blockTimestampCache.get(blockNumber);
  if (cached !== undefined) return cached;
  const block = await publicClient.getBlock({ blockNumber });
  blockTimestampCache.set(blockNumber, block.timestamp);
  // Keep cache bounded: evict entries older than current minus 200 blocks.
  if (blockTimestampCache.size > 200) {
    const oldest = [...blockTimestampCache.keys()].sort((a, b) => (a < b ? -1 : 1))[0];
    blockTimestampCache.delete(oldest);
  }
  return block.timestamp;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function is429(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('429') || /rate.?limit/i.test(msg) || /too many requests/i.test(msg);
}

// ── Log fetching with per-chunk retry ─────────────────────────────────────────

// 6 attempts, 2 s base, 60 s cap → waits up to ~2+4+8+16+32+60 = 122 s total.
const FETCH_MAX_RETRIES = 6;
const FETCH_BASE_DELAY_MS = 2_000;

async function fetchLogsWithRetry(fromBlock: bigint, toBlock: bigint): Promise<Log[]> {
  for (let attempt = 1; attempt <= FETCH_MAX_RETRIES; attempt++) {
    try {
      const [factoryLogs, escrowLogs] = await Promise.all([
        publicClient.getLogs({
          address: deployment.EscrowFactory.proxy as `0x${string}`,
          fromBlock,
          toBlock,
        }),
        publicClient.getLogs({
          address: deployment.Escrow.address as `0x${string}`,
          fromBlock,
          toBlock,
        }),
      ]);
      // Merge and sort by block then log index so handlers receive events in emission order.
      return [...factoryLogs, ...escrowLogs].sort((a, b) => {
        const blockDiff = Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n));
        if (blockDiff !== 0) return blockDiff;
        return (a.logIndex ?? 0) - (b.logIndex ?? 0);
      });
    } catch (err) {
      const rateLimit = is429(err);
      const delayMs = Math.min(FETCH_BASE_DELAY_MS * 2 ** (attempt - 1), 60_000);

      if (attempt === FETCH_MAX_RETRIES) {
        // Caller decides how to handle exhaustion — it will not crash the process.
        throw err;
      }

      console.warn(
        `[indexer] getLogs ${fromBlock}–${toBlock}: attempt ${attempt}/${FETCH_MAX_RETRIES}` +
          (rateLimit ? ' (rate-limited 429)' : '') +
          `, retrying in ${delayMs} ms`,
      );
      await sleep(delayMs);
    }
  }
  throw new Error('unreachable');
}

// ── Log dispatcher ────────────────────────────────────────────────────────────

async function dispatchLog(log: Log): Promise<void> {
  const blockNumber = log.blockNumber ?? 0n;
  const blockTimestamp = await getBlockTimestamp(blockNumber);
  const meta: HandlerMeta = {
    txHash:         log.transactionHash ?? '0x',
    blockNumber,
    blockTimestamp,
    logIndex:       log.logIndex ?? 0,
  };

  // Try parsing as a factory event first, then as an escrow event.
  const factoryParsed = parseEventLogs({ abi: EscrowFactoryAbi, logs: [log], strict: false });
  if (factoryParsed.length > 0) {
    const parsed = factoryParsed[0];
    if (parsed.eventName === 'EscrowCreated') {
      await handleEscrowCreated(supabase, parsed.args as unknown as EscrowCreatedEvent, meta);
    }
    return;
  }

  const escrowParsed = parseEventLogs({ abi: EscrowAbi, logs: [log], strict: false });
  if (escrowParsed.length === 0) return;

  const parsed = escrowParsed[0];
  switch (parsed.eventName) {
    case 'EscrowFunded':
      await handleEscrowFunded(supabase, parsed.args as unknown as EscrowFundedEvent, meta);
      break;
    case 'ShipmentConfirmed':
      await handleShipmentConfirmed(supabase, parsed.args as unknown as ShipmentConfirmedEvent, meta);
      break;
    case 'Tranche1Released':
      await handleTranche1Released(supabase, parsed.args as unknown as Tranche1ReleasedEvent, meta);
      break;
    case 'FundsReleased':
      await handleFundsReleased(supabase, parsed.args as unknown as FundsReleasedEvent, meta);
      break;
    case 'ArrivalRecorded':
      await handleArrivalRecorded(supabase, parsed.args as unknown as ArrivalRecordedEvent, meta);
      break;
    case 'DisputeRaised':
      await handleDisputeRaised(supabase, parsed.args as unknown as DisputeRaisedEvent, meta);
      break;
    case 'DisputeResolved':
      await handleDisputeResolved(supabase, parsed.args as unknown as DisputeResolvedEvent, meta);
      break;
    default:
      // Other events (Paused, Upgraded, etc.) are not indexed.
      break;
  }
}

// ── Main poll cycle ───────────────────────────────────────────────────────────

// Log progress every PROGRESS_EVERY chunks during a long backfill.
const PROGRESS_EVERY = 10;
// Sleep between retries of a permanently-stuck chunk (RPC outage scenario).
const STUCK_RETRY_DELAY_MS = 60_000;

async function pollOnce(fromBlock: bigint): Promise<bigint> {
  const currentBlock = await publicClient.getBlockNumber();
  if (fromBlock > currentBlock) return fromBlock; // nothing new

  const totalBlocks = currentBlock - fromBlock + 1n;
  let processed = fromBlock;
  let chunkIndex = 0;
  let totalEvents = 0;

  while (processed <= currentBlock) {
    const chunkEnd =
      processed + BigInt(LOG_CHUNK_SIZE) - 1n < currentBlock
        ? processed + BigInt(LOG_CHUNK_SIZE) - 1n
        : currentBlock;

    // Fetch with retry. On permanent failure (all 6 attempts exhausted) we do
    // NOT crash — we log to stderr, sleep 60 s, and retry the same chunk.
    // The cursor only advances after a successful fetch, so no blocks are lost.
    let logs: Log[];
    try {
      logs = await fetchLogsWithRetry(processed, chunkEnd);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(
        `[indexer] chunk ${processed}–${chunkEnd} failed all ${FETCH_MAX_RETRIES} attempts. ` +
          `Sleeping ${STUCK_RETRY_DELAY_MS / 1_000} s before retry.`,
      );
      // Write to stderr so the stuck state is visible even if stdout is buffered or redirected.
      process.stderr.write(
        `[indexer] STUCK blocks=${processed}–${chunkEnd} network=${NETWORK} error="${errMsg}"\n`,
      );
      await sleep(STUCK_RETRY_DELAY_MS);
      continue; // re-enter the loop at the same `processed` value
    }

    for (const log of logs) {
      try {
        await dispatchLog(log);
      } catch (err) {
        console.error(`[indexer] Error dispatching log (tx ${log.transactionHash}):`, err);
        // Continue with next log — one bad event must not stall the indexer.
      }
    }

    totalEvents += logs.length;
    await writeCursor(chunkEnd);

    chunkIndex++;
    if (chunkIndex % PROGRESS_EVERY === 0) {
      const processedSoFar = chunkEnd - fromBlock + 1n;
      console.log(
        `[indexer] backfill: processed blocks ${fromBlock}–${chunkEnd} of ${fromBlock + totalBlocks - 1n}` +
          ` (${processedSoFar}/${totalBlocks} blocks, ${totalEvents} events found)`,
      );
    } else if (logs.length > 0) {
      console.log(`[indexer] Processed blocks ${processed}–${chunkEnd} (${logs.length} logs)`);
    }

    processed = chunkEnd + 1n;

    // Pace between chunks to stay within Alchemy free-tier compute-unit budget.
    if (CALL_DELAY_MS > 0) await sleep(CALL_DELAY_MS);
  }

  return currentBlock + 1n; // next poll starts from the block after current
}

// ── Startup and loop ──────────────────────────────────────────────────────────

export async function startIndexer(): Promise<void> {
  console.log(`[indexer] Starting. Oracle address: ${oracleAddress}`);
  console.log(`[indexer] Network: ${deployment.network} (chainId ${deployment.chainId})`);
  console.log(`[indexer] EscrowFactory: ${deployment.EscrowFactory.proxy}`);
  console.log(`[indexer] Escrow:        ${deployment.Escrow.address}`);
  console.log(`[indexer] Poll interval: ${INDEXER_POLL_MS} ms`);
  console.log(`[indexer] Log chunk size: ${LOG_CHUNK_SIZE} blocks, inter-call delay: ${CALL_DELAY_MS} ms`);

  let nextFrom = await readCursor();
  const deploymentBlock = BigInt(deployment.deploymentBlock);
  if (nextFrom < deploymentBlock) nextFrom = deploymentBlock;

  console.log(`[indexer] Backfilling from block ${nextFrom}…`);

  // Run the first poll immediately (backfill), then settle into the interval.
  nextFrom = await pollOnce(nextFrom);

  const interval = setInterval(async () => {
    try {
      nextFrom = await pollOnce(nextFrom);
    } catch (err) {
      console.error('[indexer] Poll error:', err);
      // Don't crash; retry next interval.
    }
  }, INDEXER_POLL_MS);

  // Graceful shutdown
  const shutdown = (): void => {
    console.log('[indexer] Shutting down…');
    clearInterval(interval);
    process.exit(0);
  };
  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);
}

// Run standalone when executed directly.
if (require.main === module) {
  startIndexer().catch((err) => {
    console.error('[indexer] Fatal:', err);
    process.exit(1);
  });
}
