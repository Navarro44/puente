# web

Next.js 14 App Router web application for Puente.

## Personas

- **CFO / Finance Director** — aggregate volume, cumulative cost saved vs. SWIFT baseline, per-transaction FX rates, full exportable audit trail, transaction history.
- **Head of Procurement** — active shipments with milestone status, supplier communications thread, B/L tracking, transaction creation, receipt confirmation.
- **Supplier** — B/L upload and shipment status visibility (Phase 1 minimal view; full dashboard in Phase 3).

## Stack

- **Next.js 14** App Router · TypeScript · Tailwind CSS
- **Supabase** for Postgres, auth, and document storage (B/L files, KYB documents)
- **wagmi + viem** for wallet connectivity (planned)

## Commands

```bash
pnpm dev      # next dev (hot reload)
pnpm build    # next build (production)
pnpm start    # next start (serve production build)
pnpm clean    # rm -rf .next out
```

Required env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. See root `.env.example`.
