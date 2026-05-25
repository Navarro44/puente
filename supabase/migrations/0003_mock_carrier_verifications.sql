-- Phase 1 mock carrier state, persisted to Supabase so the arm-bl.ts script
-- can arm verifications from a separate process without shared in-memory state.
--
-- The SupabaseMockCarrierAdapter (apps/oracle/src/carrier.ts) reads from this
-- table on every oracle poll cycle. The arm-bl.ts script upserts a row to
-- mark a B/L as verified.
--
-- This table shapes the same seam the real carrier adapter will use in Phase 2:
-- carriers write to an external queue (their API), the oracle reads from it.
-- Swapping SupabaseMockCarrierAdapter for a MaerskCarrierAdapter requires no
-- changes to oracle.ts or handlers.ts.

CREATE TABLE IF NOT EXISTS public.mock_carrier_verifications (
  bl_ref      TEXT        PRIMARY KEY,
  valid       BOOLEAN     NOT NULL DEFAULT false,
  shipper     TEXT        NOT NULL DEFAULT '',
  consignee   TEXT        NOT NULL DEFAULT '',
  in_transit  BOOLEAN     NOT NULL DEFAULT false,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.mock_carrier_verifications ENABLE ROW LEVEL SECURITY;
-- No public policies: only the service-role key (oracle/indexer) may read or write.
