# Puente Oracle Service

Standalone Node.js worker with two independently startable processes: the **chain
indexer** and the **oracle worker**.

## Processes

| Process | Entry point | Responsibility |
|---|---|---|
| Indexer | `dist/indexer.js` | Polls chain events → syncs Supabase + ledger |
| Oracle worker | `dist/oracle.js` | Verifies B/Ls → submits on-chain txs |
| Combined | `dist/index.js` | Starts both in one process |

```sh
pnpm build            # compile TypeScript → dist/
pnpm start            # start both (combined)
pnpm start:indexer    # start indexer only
pnpm start:oracle     # start oracle worker only
pnpm dev              # ts-node src/index.ts (dev mode, both)
pnpm dev:indexer      # ts-node src/indexer.ts
pnpm dev:oracle       # ts-node src/oracle.ts
pnpm clean            # rm -rf dist/
```

## Required environment variables

| Variable | Description |
|---|---|
| `ORACLE_PRIVATE_KEY` | Oracle signing key (`0x…`). **See Key Management below.** |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (bypasses RLS — server-side only) |
| `BASE_SEPOLIA_RPC_URL` | RPC endpoint for Base Sepolia |
| `ORACLE_NETWORK` | `baseSepolia` (default) or `base` |
| `ORACLE_POLL_INTERVAL_MS` | Polling interval in ms (default `15000`) |

Copy `.env.example` from the repo root and fill in the values.

## Contract addresses

Addresses are read from `packages/contracts/deployments/{network}.json` at startup —
**not** from `.env`. Run `pnpm deploy:baseSepolia` in `packages/contracts` to generate
this file, then restart the oracle. No env-file edit is needed after a redeploy.

## Key management

### Phase 1 — testnet

`ORACLE_PRIVATE_KEY` is read from `.env`. Acceptable for testnet development only.
The wallet should hold only enough ETH for gas and **no asset value**.

### Production (Phase 2+)

The raw private key **must never** appear in an environment file on a production host.
Use one of the following approaches:

**AWS KMS / GCP Cloud HSM**
Use viem's JSON-RPC account with a KMS signer adapter. Signing happens inside the
hardware security boundary; the private key never leaves the HSM.

**HashiCorp Vault Transit**
Store key material in Vault's Transit secrets engine. Retrieve a short-lived signing
token at startup; never cache the raw key.

**AWS Secrets Manager + envelope encryption**
Encrypt key material with a KMS CMK; decrypt at runtime. Hold the key in memory only
for the duration of the signing operation.

In all production setups:
- The key is **never logged**, even at debug level.
- The key is **never written to disk** or included in any error message or stack trace.
- The oracle wallet is rotated by calling `EscrowFactory.setOracle(newAddress)` from
  the admin multisig and redeploying the oracle with the new key.

## Chain indexer

### Why polling (Phase 1)?

Polling requires no webhook infrastructure, no public IP, and no Alchemy subscription.
It works identically in local dev, CI, and a simple VPS. One poll interval (15 s) of
latency is acceptable for the MVP trade-finance flow.

### Webhook adapter seam

All business logic lives in `src/handlers.ts`. The polling loop in `src/indexer.ts` is
a thin feed layer: it fetches raw logs, decodes them with `viem.parseEventLogs`, and
calls handler functions. Replacing it with an Alchemy webhook or subgraph subscription
requires **no changes to handlers.ts** — just parse the incoming payload and call the
same functions.

### Backfill on restart

The last fully-processed block is persisted to `apps/oracle/data/indexer_cursor.json`.
On startup the indexer reads the cursor and replays from that block forward, so no
events are missed after a restart. All handlers use upsert/update-where semantics, so
replaying an already-processed block is a safe no-op.

## Oracle worker

The worker polls Supabase for:

1. **Shipped** transactions with a `pending` B/L → calls
   `CarrierApiAdapter.verifyBillOfLading(blRef)`. If valid and in transit, submits
   `Escrow.verifyBL(escrowId, blRef)`, triggering the 30% tranche-1 partial release.

2. **PartialReleased** transactions → calls `CarrierApiAdapter.getArrival(blRef)`.
   If arrival is reported, submits `Escrow.recordArrival(escrowId)`, starting the
   14-day buyer-confirm timeout clock.

### Phase 1: arming the mock carrier adapter

In Phase 1 the carrier adapter is `MockCarrierApiAdapter`. An operator manually arms
verifications and arrivals (from a REPL or admin script):

```typescript
import { getAdapters } from '@puente/shared/mocks';
import type { MockCarrierApiAdapter } from '@puente/shared/mocks';

const carrier = getAdapters().carrier as MockCarrierApiAdapter;

// After manual B/L review:
carrier.armVerification('0x4d534b55…', {
  valid: true,
  shipper: 'Quimex SA de CV',
  consignee: 'Singapore ChemCo Pte Ltd',
  inTransit: true,
});

// When the cargo arrives at port:
carrier.armArrival('0x4d534b55…', {
  arrivalTimestamp: Math.floor(Date.now() / 1000),
  portOfDischarge: 'SGSIN',
});
```

`armVerification` / `armArrival` are in-memory; they reset when the process restarts.

## Double-entry ledger

The indexer writes balanced `ledger_entries` rows for every fund-affecting event.

Chart of accounts:

| Account | Meaning |
|---|---|
| `buyer:<address>` | Buyer's economic outflow |
| `escrow:<escrowId>` | Funds held by the escrow contract |
| `supplier:<address>` | Supplier's economic inflow |
| `protocol_fee:<address>` | Protocol fee revenue |

Invariant: for every group written together, `SUM(debit) = SUM(credit)`. Asserted
in `src/ledger.ts` before each write — an imbalance throws before touching the DB.

The ledger records what happened on-chain. It **never authorises** a movement.
The chain is always the source of truth for funds.
