# oracle

Standalone Node.js oracle service and chain indexer for Puente.

## Responsibilities

**Oracle worker** — watches `Shipped`-state escrows with an attached bill-of-lading reference, calls the carrier API adapter to verify the B/L (valid number, matching shipper/consignee, container in transit), then submits the signed verification transaction from the oracle address to trigger the 30% partial release on-chain.

**Chain indexer** — listens to `EscrowFactory` and `Escrow` on-chain events and writes state changes to Supabase, keeping the off-chain read-mirror consistent with on-chain truth. Every transition also appends an `audit_events` record.

## Phase 1 note

The carrier API adapter is a **manual-confirmation stub** in Phase 1 — an operator verifies the B/L by hand and the service submits the transaction. The interface is identical to the automated Phase 2 version; the real implementation is a transparent swap.

## Commands

```bash
pnpm build     # tsc → dist/
pnpm start     # node dist/index.js
pnpm dev       # ts-node src/index.ts (development)
pnpm clean     # rm -rf dist/
```

Required env vars: `BASE_SEPOLIA_RPC_URL` or `BASE_MAINNET_RPC_URL`, `ORACLE_PRIVATE_KEY`, `ORACLE_NETWORK`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. See root `.env.example`.
