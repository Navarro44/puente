/**
 * arm-bl.ts — persist a bill-of-lading verification to the mock_carrier_verifications
 * Supabase table so the running oracle process picks it up on its next poll cycle.
 *
 * Usage:
 *   pnpm --filter oracle arm:bl <bytes32-hex-bl-ref>
 *
 * Example:
 *   pnpm --filter oracle arm:bl 0x544553542d424c2d313731363030303030303030000000000000000000000000
 *
 * The B/L reference is the hex value printed by the seed-test-transaction script.
 * After running this, the oracle's next poll (≤ 15 s) will find the B/L verified,
 * log "submitting verifyBL…", and submit the on-chain transaction.
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// CommonJS: __dirname is a global pointing to this file's directory (scripts/).
// Resolve up to the repo root where .env lives regardless of pnpm's cwd.
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// ── Env validation ────────────────────────────────────────────────────────────

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  console.error('[arm-bl] Missing SUPABASE_URL in .env');
  process.exit(1);
}
if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[arm-bl] Missing SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

// ── CLI arg ───────────────────────────────────────────────────────────────────

const blRef = process.argv[2];

if (!blRef) {
  console.error('[arm-bl] Missing B/L reference argument.');
  console.error('');
  console.error('Usage:   pnpm --filter oracle arm:bl <bytes32-hex>');
  console.error('Example: pnpm --filter oracle arm:bl 0x544553542d424c...0000');
  console.error('');
  console.error('The bytes32 hex is printed by the seed-test-transaction script.');
  process.exit(1);
}

// A valid bytes32 is a 0x-prefixed 64-character hex string (32 bytes = 66 chars total).
if (!/^0x[0-9a-fA-F]{64}$/.test(blRef)) {
  console.error('[arm-bl] Invalid B/L reference format.');
  console.error(`         Expected: 0x followed by exactly 64 hex characters (32 bytes).`);
  console.error(`         Got:      ${blRef}`);
  process.exit(1);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  console.log('[arm-bl] Arming mock carrier verification…');
  console.log(`         B/L ref:   ${blRef}`);
  console.log(`         Shipper:   Test Shipper SA de CV`);
  console.log(`         Consignee: Test Consignee Pte Ltd`);
  console.log(`         inTransit: true`);

  const { error } = await supabase
    .from('mock_carrier_verifications')
    .upsert(
      {
        bl_ref:      blRef,
        valid:       true,
        shipper:     'Test Shipper SA de CV',
        consignee:   'Test Consignee Pte Ltd',
        in_transit:  true,
        verified_at: new Date().toISOString(),
      },
      { onConflict: 'bl_ref' },
    );

  if (error) {
    console.error('[arm-bl] Supabase upsert failed:', error.message);
    console.error('         Ensure the mock_carrier_verifications table exists.');
    console.error('         Apply migration: supabase/migrations/0003_mock_carrier_verifications.sql');
    process.exit(1);
  }

  console.log('[arm-bl] Verification armed successfully.');
  console.log('         The oracle will pick it up on its next poll cycle (≤ 15 s).');
  console.log('         Watch oracle logs for: "[oracle] escrow … B/L verified … Submitting verifyBL…"');
}

main().catch((err: unknown) => {
  console.error('[arm-bl] Fatal:', err);
  process.exit(1);
});
