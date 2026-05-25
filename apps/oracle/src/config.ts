/**
 * Configuration loader for the Puente oracle service.
 *
 * Contract addresses are read from packages/contracts/deployments/{network}.json
 * rather than .env, so a redeploy propagates automatically without env-file edits.
 *
 * Runtime secrets are validated at process startup so failures are loud and
 * immediate.
 *
 * ── Oracle signing key: Phase 1 vs. Production ────────────────────────────────
 *
 * Phase 1 (testnet):
 *   ORACLE_PRIVATE_KEY is read directly from the .env file. This is acceptable
 *   for testnet development. The key should belong to a dedicated EOA that holds
 *   only enough ETH for gas and NO asset value.
 *
 * Production path (Phase 2+):
 *   The raw private key must NEVER appear in an environment file on a production
 *   host. Use one of:
 *
 *   • AWS KMS / GCP Cloud HSM — viem ships a KMS signer adapter; the private key
 *     never leaves the hardware security boundary. Signing happens inside KMS.
 *     Reference: https://viem.sh/docs/clients/wallet#json-rpc-account
 *
 *   • HashiCorp Vault Transit — store the key in Vault's Transit secrets engine.
 *     Retrieve a short-lived signing token at startup; never cache the raw key.
 *
 *   • AWS Secrets Manager + envelope encryption — store the key material
 *     encrypted; decrypt at runtime using a KMS CMK. Key is held in memory only
 *     for the duration of the signing operation.
 *
 *   In all cases:
 *     - The key is NEVER logged, even in debug mode.
 *     - The key is NEVER written to disk or included in any error message.
 *     - The oracle wallet holds NO USDC or other value; it only needs ETH for gas.
 *     - Rotate the oracle key by calling EscrowFactory.setOracle() from the admin
 *       multisig and deploying a new oracle instance with the new key.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

// Load root .env (two directories up from apps/oracle/src → apps/oracle → apps → repo root)
dotenv.config({ path: path.join(__dirname, '../../../.env') });

// ── Deployment file ───────────────────────────────────────────────────────────

export interface ProtocolConfig {
  feeBps: number;
  oracle: string;
  arbitrator: string;
  feeRecipient: string;
}

export interface DeploymentRecord {
  network: string;
  chainId: number;
  deploymentBlock: number;
  usdcAddress: string;
  protocolConfig: ProtocolConfig;
  EscrowFactory: { proxy: string; implementation: string };
  Escrow: { address: string };
  SupplierRegistry: { proxy: string; implementation: string };
}

function loadDeployment(network: string): DeploymentRecord {
  const filePath = path.join(
    __dirname,
    '../../../packages/contracts/deployments',
    `${network}.json`,
  );
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `[config] Deployment file not found: ${filePath}\n` +
        `Run "pnpm deploy:baseSepolia" in packages/contracts first, then restart the oracle.`,
    );
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as DeploymentRecord;
}

// ── Env helpers ───────────────────────────────────────────────────────────────

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`[config] Missing required environment variable: ${key}`);
  return value;
}

// ── Exports ───────────────────────────────────────────────────────────────────

export const NETWORK = (process.env.ORACLE_NETWORK ?? 'baseSepolia') as 'baseSepolia' | 'base';
export const deployment: DeploymentRecord = loadDeployment(NETWORK);

export const RPC_URL: string =
  NETWORK === 'base'
    ? (process.env.BASE_MAINNET_RPC_URL ?? 'https://mainnet.base.org')
    : (process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org');

/**
 * Oracle signing key — loaded from environment, never from source.
 * See module JSDoc for the production KMS path.
 * NEVER log this value.
 */
export const ORACLE_PRIVATE_KEY: `0x${string}` = requireEnv('ORACLE_PRIVATE_KEY') as `0x${string}`;

export const SUPABASE_URL: string = requireEnv('SUPABASE_URL');
export const SUPABASE_SERVICE_ROLE_KEY: string = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

/** Milliseconds between indexer polling cycles. */
export const INDEXER_POLL_MS: number = parseInt(
  process.env.ORACLE_POLL_INTERVAL_MS ?? '15000',
  10,
);

/** Milliseconds between oracle worker polling cycles. */
export const ORACLE_POLL_MS: number = parseInt(
  process.env.ORACLE_POLL_INTERVAL_MS ?? '15000',
  10,
);

/**
 * Block range per eth_getLogs call.
 * Alchemy free tier caps this at 10 blocks per call.
 * Paid/dedicated tiers support up to 2 000–10 000.
 * Set INDEXER_LOG_CHUNK_SIZE in .env to match your plan.
 */
export const LOG_CHUNK_SIZE: number = parseInt(
  process.env.INDEXER_LOG_CHUNK_SIZE ?? '10',
  10,
);

/**
 * Milliseconds to wait between successful eth_getLogs chunks.
 * Paces backfill to avoid saturating the Alchemy free-tier compute-unit budget.
 * Increase if you still see 429s; set to 0 on a paid plan with headroom.
 */
export const CALL_DELAY_MS: number = parseInt(
  process.env.INDEXER_CALL_DELAY_MS ?? '200',
  10,
);
