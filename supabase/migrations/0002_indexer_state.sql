-- Indexer cursor: one row per network, tracking the last fully-processed block.
-- Keyed by network name so the same indexer binary works for baseSepolia,
-- base (mainnet), and any future chain without schema changes.
--
-- last_processed_block is BIGINT. Postgres BIGINT holds up to ~9.2e18;
-- Base block numbers are well below JS's safe-integer ceiling (~9e15),
-- so Number() round-trips are lossless for the foreseeable future.

CREATE TABLE IF NOT EXISTS public.indexer_state (
  network              TEXT        PRIMARY KEY,
  last_processed_block BIGINT      NOT NULL,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.indexer_state ENABLE ROW LEVEL SECURITY;
-- No public policies: only the service-role key (oracle/indexer) may read or write.
