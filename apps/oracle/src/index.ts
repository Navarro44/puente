/**
 * Puente oracle service — combined entrypoint.
 *
 * Starts both the chain indexer and the oracle worker in the same process.
 * Each can also be started independently:
 *
 *   node dist/indexer.js   — indexer only
 *   node dist/oracle.js    — oracle worker only
 *   node dist/index.js     — both (this file)
 */

import { startIndexer } from './indexer';
import { startOracle } from './oracle';

async function main(): Promise<void> {
  console.log('[puente-oracle] Starting Puente oracle service (indexer + oracle worker)…');
  await Promise.all([startIndexer(), startOracle()]);
}

main().catch((err: unknown) => {
  console.error('[puente-oracle] Fatal startup error:', err);
  process.exit(1);
});
