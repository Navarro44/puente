# CLAUDE.md — Puente

This file is the standing context for Claude Code working in this repository. Read it
fully before any task. It is the authoritative summary of *what* Puente is and *how* it
must be built. The full reference is `docs/puente-technical-spec.md`; this file is the
operating contract.

---

## 1. What Puente is

Puente is a **non-custodial trade finance platform** for the **Mexico → Singapore
chemical trade corridor**. It does two things:

1. Replaces SWIFT wire transfers with **USDC settlement on Base**.
2. Replaces letters of credit with **programmable milestone-based on-chain escrow**.

The customer is a Mexican mid-market chemical importer ($5M–$50M revenue) paying a
Chinese chemical supplier that holds a Singapore or Hong Kong receiving entity. A
typical shipment is $50K–$500K. SWIFT today costs them 3–5% all-in and takes 3–5 days
with no visibility; Puente targets sub-2-hour settlement at ~0.5%.

**The platform never custodies fiat.** Licensed partners handle the MXN on-ramp and the
SGD/USD off-ramp. Puente is the software orchestration layer, the on-chain escrow, and
the supplier verification registry — nothing more.

---

## 2. The five components

1. **Smart contracts** — Solidity on Base. `EscrowFactory`, `Escrow`, `SupplierRegistry`.
   This is the on-chain spine and the source of truth for funds.
2. **Web application** — Next.js 14 (App Router) + Supabase. Two buyer personas (CFO
   dashboard, procurement transaction view) plus a minimal supplier view.
3. **Oracle service** — standalone Node.js worker. Verifies bills of lading and submits
   signed release transactions on-chain.
4. **KYB pipeline** — runs know-your-business checks on Chinese suppliers and issues
   reusable on-chain-anchored credentials.
5. **Ramp adapters** — pluggable interfaces for MXN on-ramp and SGD/USD off-ramp.

---

## 3. Non-negotiable engineering principles

These override convenience. If a task conflicts with one of these, stop and flag it.

- **Interfaces over integrations.** Every external dependency — carrier APIs, KYB
  providers, ramp partners, sanctions screening — is a TypeScript interface (or Solidity
  interface) with a **mock implementation** and a **real implementation**. The core
  system is built and tested entirely against mocks. Never let core logic import a
  concrete partner SDK directly.
- **Chain is the source of truth for funds.** The Supabase database is a fast
  read-mirror kept in sync by the indexer. The database must **never** authorize or
  trigger a fund movement. On-chain state wins every conflict.
- **Immutable escrow terms.** Once an escrow is funded, its parties, amounts, and
  milestone structure cannot change. Enforce this in contract code, not by convention.
- **Corridor-agnostic data model, corridor-specific product.** v1 is Mexico→Singapore
  only, but do not hardcode currency assumptions (MXN, CNY, SGD) into database schemas
  or contract logic. Be opinionated in the UI; be general in the data model.
- **Auditability everywhere.** Every meaningful action writes an `audit_events` record.
  The CFO persona's entire value is a clean, exportable audit trail.
- **Secrets discipline.** The oracle signing key and all partner API credentials live in
  a secret store / environment, never in source, never committed. `.env` is gitignored;
  `.env.example` documents required variables with placeholder values.
- **Build in phase order.** Contracts first, fully tested in isolation, before any
  off-chain code depends on them. Do not scaffold the whole system at once.

---

## 4. Repository layout

A `pnpm` monorepo. Workspace packages:

```
puente/
  CLAUDE.md                 # this file
  docs/
    puente-technical-spec.md  # full authoritative spec
  packages/
    contracts/              # Hardhat project — Solidity contracts + tests
    shared/                 # shared TypeScript: types, enums, event ABIs, interfaces
  apps/
    web/                    # Next.js 14 App Router + Supabase
    oracle/                 # Node.js oracle service + chain indexer
  pnpm-workspace.yaml
  package.json
```

`packages/shared` is the single home for cross-component contracts: escrow state enum,
event shapes, the ramp/carrier/KYB/sanctions interface definitions. `apps/web` and
`apps/oracle` both depend on it. This is how the "interfaces over integrations"
principle is physically enforced.

---

## 5. Smart contract layer (the spine)

- **Chain:** Base mainnet (production), Base Sepolia (development/testing).
- **Token:** native Circle-issued USDC on Base — not a bridged variant.
- **Framework:** **Hardhat** (TypeScript). The repo standardizes on Hardhat for
  contract development and testing, reusing existing team experience. Tests are written
  in TypeScript with `hardhat-toolbox` (ethers + chai + the network helpers). Fuzz-style
  coverage of fee and tranche math is achieved with parameterized/property tests over
  wide input ranges.
- **Libraries:** OpenZeppelin for access control, UUPS upgradeability, pausing,
  `ReentrancyGuard`, and `SafeERC20`.

### Contracts

- **`EscrowFactory`** — deploys/tracks escrows, holds protocol config (fee bps, fee
  recipient, oracle address, arbitrator address, token address). UUPS upgradeable.
  Emits an event per escrow creation.
- **`Escrow`** — **a single shared contract** holding per-transaction state in mappings
  keyed by escrow ID (preferred over one deployed contract per transaction, for gas).
  Each escrow record is immutable once funded.
- **`SupplierRegistry`** — stores a hash anchor of each supplier's KYB credential plus a
  status flag and expiry. UUPS upgradeable. Detailed KYB data lives off-chain.

### Escrow state machine

```
Created --fund--> Funded --shipConfirmed--> Shipped --oracleVerifyBL--> PartialReleased
PartialReleased --buyerConfirmReceipt--> Completed
PartialReleased --timeoutRelease--> Completed
Funded | Shipped | PartialReleased --raiseDispute--> Disputed
Disputed --arbitratorResolve--> Resolved
```

- `Created → Funded`: full transaction amount in USDC lands for that escrow ID.
- `Funded → Shipped`: supplier records shipment + attaches a B/L reference. A claim,
  not a verification.
- `Shipped → PartialReleased`: **oracle address only**, with B/L proof. Releases
  tranche 1 (default 30%).
- `PartialReleased → Completed`: buyer confirms receipt, OR anyone calls
  `timeoutRelease` 14 days after carrier-confirmed arrival. Releases tranche 2 (70%).
- `→ Disputed`: buyer only, from `Funded`/`Shipped`/`PartialReleased`. Freezes funds.
- `Disputed → Resolved`: **arbitrator address only**. Specifies a buyer/supplier split
  of remaining funds; no other destination permitted.

### Roles

- **buyer** (per-escrow) — funds, confirms receipt, raises disputes.
- **supplier** (per-escrow) — confirms shipment, receives released funds.
- **oracle** (protocol-level whitelisted address) — submits B/L verification. v1 is a
  single address; the interface must generalize to a threshold set of attesters
  **without rewriting the contract**.
- **arbitrator** (protocol-level whitelisted address) — resolves disputes, constrained
  to buyer/supplier payouts only.
- **owner/admin** (protocol-level) — updates fee config, oracle, arbitrator; may pause
  new escrow creation. **Must NOT be able to touch funds in existing funded escrows.**

### Fees

- Protocol fee in basis points, target **50 bps (0.5%)**.
- **Charge the fee at funding**: buyer funds `amount + fee`, so the supplier always
  receives the clean agreed amount. (This resolves the spec's open question; document
  it in contract NatSpec.)
- Fee goes to a configurable `feeRecipient`.

### Safety requirements (enforce in code)

- `ReentrancyGuard` on every fund-moving function.
- `SafeERC20` for all USDC transfers.
- Immutable escrow terms post-funding.
- Emergency pause halts **new escrow creation only** — it must never freeze, redirect,
  or block settlement of already-funded escrows.
- Every state transition emits an event with enough data for the indexer to reconstruct
  full state.
- The arbitrator's resolution must validate `buyerSplit + supplierSplit == remaining
  balance` exactly.

### Testing (required before the layer is "done")

Hardhat tests (TypeScript, `hardhat-toolbox`) covering: every valid state transition;
every invalid transition (oracle releasing an unfunded escrow, buyer confirming before
partial release, non-arbitrator resolving, etc.); the timeout path (use the network
time helpers); dispute splits including 100/0 and 0/100; **property/parameterized tests
on amounts and fee math over wide input ranges**; a full happy-path integration test
(create→fund→ship→verify→confirm→completed); and a reentrancy attack test against a
malicious token/recipient. Use `solidity-coverage` to confirm every transition function
is exercised.

---

## 6. Web application

- Next.js 14, App Router. Tailwind for styling.
- Supabase for Postgres, auth, and file storage (B/L documents, KYB documents).
- Wallet connectivity via wagmi + viem.

### Personas

- **CFO / Finance Director (dashboard)** — aggregate volume, cumulative cost saved vs.
  SWIFT baseline, per-transaction FX rates, full exportable audit trail, history.
- **Head of Procurement (transaction view)** — active shipments with milestone status,
  supplier comms thread, B/L tracking, transaction creation, receipt confirmation.
- **Supplier** — minimal in Phase 1 (status visibility, B/L upload); full dashboard in
  Phase 3.

### Core tables

`organizations`, `users`, `suppliers`, `transactions`, `milestones`,
`bills_of_lading`, `documents`, `messages`, `disputes`, `audit_events`,
`ledger_entries`. The database mirrors on-chain state for fast reads; the indexer keeps
it in sync. See the spec §5.4 for column-level detail.

### Double-entry ledger

`ledger_entries` is a **double-entry accounting ledger**, distinct from `audit_events`.
`audit_events` is an event log — it records *what happened*. `ledger_entries` records
*whether the books balance*. Every fund-affecting state change writes a set of balanced
entries (each row: `transaction_id`, `account`, `debit`, `credit`, `currency`,
`timestamp`, plus a reference to the originating on-chain event); for any group, total
debits must equal total credits.

This is the foundation for reconciliation, for the CFO persona's audit and reporting,
and for proving correctness to regulators and auditors. The chain remains the source of
truth for funds (Section 3); the ledger is the accounting *interpretation* of on-chain
movements, written by the indexer alongside the mirror tables.

**Phase 1 scope:** build the table and write balanced entries at each escrow state
transition, even though the MVP UI does not yet read from it heavily. The cost is one
table and a few inserts; the benefit is a ledger-shaped data model from the first
migration. Retrofitting double-entry onto a system not built for it is expensive — so it
goes in now, as structure, not as a deferred feature.

---

## 7. Oracle service and chain indexer

A standalone Node.js worker, **separate from the web app**.

- **Oracle:** watches `Shipped`-state transactions with an attached B/L, calls the
  carrier API adapter to verify the B/L (number valid, shipper/consignee match the
  parties, container in transit), then submits the verification transaction from the
  oracle address to trigger partial release. Continues polling for arrival and records
  the arrival timestamp so the 14-day timeout clock is well-defined. Handles retries,
  transient failures, and rate limits gracefully.
- **Indexer:** listens to Factory/Escrow events and writes state changes to Supabase,
  keeping the off-chain mirror consistent with on-chain truth. Alchemy webhooks or a
  polling indexer. Every transition updates `transactions`/`milestones` and appends an
  `audit_events` record.
- In **Phase 1** the "carrier API adapter" is a **manual-confirmation stub** — an
  operator verifies the B/L by hand and the service submits the transaction. The
  interface is **identical** to the automated version so the Phase 2 swap is transparent.
- The oracle signing key is sensitive: secret store / KMS, never in source.

---

## 8. Ramp adapters and external interfaces

All of these are interfaces with a mock (Phase 1) and a real implementation (Phase 2+).
**Nothing in core logic may depend on a concrete partner.**

- **On-ramp (MXN → USDC):** quote, execute (deposits USDC to a given escrow), status.
  Mock moves test USDC on Base Sepolia from a funded test wallet. Real: Bitso Business
  API or equivalent licensed Mexican partner.
- **Off-ramp (USDC → SGD/USD):** quote, execute payout to a supplier's Singapore bank
  account, status. Mock simulates and marks complete. Real: StraitsX / Triple-A /
  Aspire (MAS-licensed).
- **Carrier API:** verifies bills of lading. Mock = manual stub. Real: Maersk developer
  API, COSCO via Vizion/project44.
- **KYB provider:** Chinese business-registry lookup. Mock returns canned credential
  data. Real: Tianyancha / Qichacha (API access likely needs a Chinese entity — treat
  with care).
- **Sanctions screening:** every party (buyer org, supplier, Singapore receiving
  entity) screened against OFAC/UN/EU/UK lists **before any escrow is funded**. Mock
  for Phase 1. Real: ComplyAdvantage / Chainalysis / equivalent.
- **Transaction monitoring (KYT):** ongoing surveillance of the on-chain activity
  itself — wallet risk scoring, exposure to sanctioned or high-risk addresses,
  suspicious-pattern detection — as opposed to the one-time party checks above. Mock for
  Phase 1: returns a clean risk assessment, with a way to force a flagged result for
  testing. Real: Chainalysis / TRM Labs / Elliptic.

### KYB vs. sanctions vs. KYT — three distinct checks

Do not conflate these; they answer different questions and run at different times.

- **KYB** — is the supplier a real, legitimate business? A one-time onboarding gate,
  anchored as a credential in `SupplierRegistry`.
- **Sanctions screening** — is any party on a watchlist? Run on every party immediately
  before funding; a match blocks the escrow.
- **KYT (transaction monitoring)** — is the money movement itself suspicious? Continuous
  monitoring of on-chain activity, not a one-time gate.

In Phase 1 all three are mocks behind interfaces. KYT is built as an interface now so
the seam is correct; the real implementation is Phase 2+.

---

## 9. Build phases

**Phase 1 — MVP.** End-to-end transaction on Base mainnet with at least one real
on-chain USDC transfer between a Mexico-controlled and a Singapore-controlled wallet.
Single-milestone escrow first, then the 30/70 split. Oracle with manual-stub adapter.
Indexer syncing Supabase. Web app: transaction creation, funding, status, receipt
confirmation, minimal styling. Mock ramps. Manual KYB for one supplier. Mock sanctions
screening.

**Phase 2 — Productionization.** Multi-milestone in production. Real carrier APIs.
Automated KYB business-registry lookup. Real ramp partners. Real sanctions screening.
Dispute UI and arbitration workflow. Self-serve buyer onboarding.

**Phase 3 — Network effects.** Full supplier dashboard. Reusable supplier credentials
across buyers. Inspection-oracle integration. Second-corridor exploration.

**Current focus: Phase 1.** Do not build Phase 2/3 features unless a task explicitly
asks. When in doubt, build the mock and the interface, not the real integration.

---

## 10. Working agreements for Claude Code

- Build in the order given by the prompt sequence. The contract layer must be complete
  and fully tested before off-chain code that depends on it is written.
- When you create an external dependency, create the **interface first**, then the
  mock, then wire core logic to the interface. The real implementation is a separate,
  later task.
- Write tests alongside code, not after. For contracts, a transition is not "done"
  until its valid and invalid paths are both tested.
- Never commit secrets. Update `.env.example` whenever you introduce a new env var.
- If a task would violate a Section 3 principle, stop and explain the conflict rather
  than working around it.
- Keep `docs/puente-technical-spec.md` as the source of truth for product detail; keep
  this file as the source of truth for engineering rules. If they conflict, flag it.
- Prefer clarity over cleverness. Explain non-obvious decisions in code comments and in
  the relevant package README.

## Standing facts (added during Phase 1 build)

- apps/oracle is configured as CommonJS (no "type": "module" in
  package.json, tsconfig "module": "commonjs"). Do NOT use import.meta,
  fileURLToPath, or --skipProject. __dirname is available as a global.
- All scripts load .env from the repo root, not from their own package
  directory. See scripts/deploy.ts, apps/oracle/src/indexer.ts for the
  established pattern.
- The mock carrier adapter is backed by the Supabase
  mock_carrier_verifications table, NOT in-memory state — so the
  arming script (apps/oracle/scripts/arm-bl.ts) and the oracle process
  can share verification state. The real adapter follows the same
  pattern.
- Contract addresses are read from
  packages/contracts/deployments/baseSepolia.json. Never read them
  from .env directly. A redeploy rewrites this file; everything reads
  through it.