/**
 * backfill-org-attribution.ts — attach org/supplier attribution to historical
 * transactions whose buyer_organization_id or supplier_id is NULL.
 *
 * Why this exists:
 *   The indexer no longer synthesises placeholder organisations. Any transaction
 *   indexed while its buyer/supplier wallet was unregistered has NULL attribution.
 *   Once the wallets are registered in org_wallets, this script re-attributes
 *   those rows using exactly the same lookup logic the indexer uses.
 *
 * Behaviour:
 *   • Reads the on-chain buyer/supplier addresses (chain = source of truth) for
 *     each candidate transaction, then resolves them through org_wallets.
 *   • Only fills columns that are currently NULL; never overwrites an existing
 *     attribution. Safe and idempotent — re-running produces no further change
 *     once every resolvable wallet is registered.
 *
 * Usage:
 *   pnpm --filter oracle backfill:org-attribution
 */

import { EscrowAbi } from '@puente/shared';
import { publicClient } from '../src/chain';
import { supabase } from '../src/db';
import { deployment } from '../src/config';
import { lookupBuyerOrg, lookupSupplier } from '../src/handlers';

const ESCROW_ADDR = deployment.Escrow.address as `0x${string}`;

interface OnchainParties {
  buyer: string;
  supplier: string;
}

async function getParties(escrowId: string): Promise<OnchainParties> {
  const record = (await publicClient.readContract({
    address: ESCROW_ADDR,
    abi: EscrowAbi,
    functionName: 'getEscrow',
    args: [BigInt(escrowId)],
  })) as { buyer: string; supplier: string };
  return { buyer: record.buyer, supplier: record.supplier };
}

async function main(): Promise<void> {
  console.log('[backfill] Scanning transactions with NULL org/supplier attribution…');

  const { data: rows, error } = await supabase
    .from('transactions')
    .select('id, escrow_id, buyer_organization_id, supplier_id')
    .or('buyer_organization_id.is.null,supplier_id.is.null');

  if (error) {
    console.error('[backfill] Query failed:', error.message);
    process.exit(1);
  }
  if (!rows || rows.length === 0) {
    console.log('[backfill] No transactions need attribution. Nothing to do.');
    return;
  }

  console.log(`[backfill] ${rows.length} candidate transaction(s).`);
  let updated = 0;

  for (const row of rows) {
    const escrowId = row.escrow_id as string;
    let parties: OnchainParties;
    try {
      parties = await getParties(escrowId);
    } catch (err) {
      console.warn(`[backfill] escrow ${escrowId}: on-chain read failed, skipping:`, err);
      continue;
    }

    const patch: { buyer_organization_id?: string; supplier_id?: string } = {};

    // Buyer org — only if currently null.
    let buyerOrgId = row.buyer_organization_id as string | null;
    if (!buyerOrgId) {
      buyerOrgId = await lookupBuyerOrg(supabase, parties.buyer);
      if (buyerOrgId) patch.buyer_organization_id = buyerOrgId;
    }

    // Supplier — only if currently null. Requires a known buyer org (existing or
    // just-resolved) because suppliers are per-buyer records.
    if (!row.supplier_id) {
      const supplierId = await lookupSupplier(supabase, parties.supplier, buyerOrgId);
      if (supplierId) patch.supplier_id = supplierId;
    }

    if (Object.keys(patch).length === 0) {
      console.log(
        `[backfill] escrow ${escrowId}: no registered mapping yet ` +
          `(buyer=${parties.buyer.toLowerCase()}, supplier=${parties.supplier.toLowerCase()}) — left as-is.`,
      );
      continue;
    }

    const { error: updErr } = await supabase.from('transactions').update(patch).eq('id', row.id);
    if (updErr) {
      console.error(`[backfill] escrow ${escrowId}: update failed:`, updErr.message);
      continue;
    }
    updated++;
    console.log(`[backfill] escrow ${escrowId}: attributed ${JSON.stringify(patch)}.`);
  }

  console.log(`[backfill] Done. ${updated} transaction(s) updated, ${rows.length - updated} left unattributed.`);
}

main().catch((err: unknown) => {
  console.error('[backfill] Fatal error:', err);
  process.exit(1);
});
