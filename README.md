# Puente

Puente is a non-custodial trade finance platform for the Mexico → Singapore chemical trade corridor. It replaces SWIFT wire transfers with USDC settlement on Base and replaces letters of credit with programmable milestone-based on-chain escrow. A typical $50K–$500K chemical shipment that today costs 3–5% all-in via SWIFT and takes 3–5 days settles in under two hours for ~0.5% on Puente, with a full on-chain audit trail. The platform never custodies fiat — licensed partners handle MXN on-ramp and SGD/USD off-ramp; Puente is the software orchestration layer, the on-chain escrow, and the supplier verification registry.

## Workspace layout

```
puente/
  packages/
    contracts/    Hardhat/Solidity — EscrowFactory, Escrow, SupplierRegistry on Base
    shared/       TypeScript — shared types, enums, ABIs, and external-dependency interfaces
  apps/
    web/          Next.js 14 App Router — buyer (CFO + procurement) and supplier UI
    oracle/       Node.js — bill-of-lading verification oracle and chain indexer
  docs/
    puente-technical-spec.md   Full product and engineering specification
```

## Install

```bash
# Requires Node >=18 and pnpm >=9
pnpm install
```

## Build

```bash
# Build everything in dependency order
pnpm build

# Build individual packages
pnpm --filter @puente/shared build
pnpm --filter contracts hardhat compile
pnpm --filter web build
pnpm --filter oracle build
```

## Test

```bash
pnpm test                        # runs Hardhat test suite
pnpm --filter contracts coverage # Solidity coverage via solidity-coverage
```

## Environment

Copy `.env.example` to `.env` and fill in real values before running any package that reads environment variables. See each package's README for which variables it requires. The real `.env` is gitignored.
