# @puente/shared

Single home for all cross-component TypeScript contracts in Puente. Both `apps/web` and `apps/oracle` depend on this package. Per the **interfaces over integrations** principle (CLAUDE.md §3), no package may import a concrete partner SDK directly — only the interface defined here.

## Planned contents

- **Escrow state enum** and transition event types (mirrors the on-chain state machine)
- **On-chain event shapes** consumed by the web app and the oracle indexer
- **External-dependency interfaces**: carrier API, KYB provider, MXN on-ramp, SGD/USD off-ramp, sanctions screening
- **Mock implementations** of every interface — used in Phase 1 and in all tests

## Build

```bash
pnpm build     # tsc → dist/
pnpm clean     # rm -rf dist/
pnpm typecheck # type-check only, no emit
```

This package must be built before `apps/web` or `apps/oracle` consume its types from `dist/`.
