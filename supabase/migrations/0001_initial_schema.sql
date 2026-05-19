-- =============================================================================
-- Puente — initial schema migration
-- =============================================================================
-- Table creation order respects foreign-key dependencies.
-- RLS is enabled on every table; policies restrict each user to their own
-- organisation's data.
--
-- Append-only enforcement on audit_events and ledger_entries is implemented
-- via BEFORE UPDATE/DELETE triggers so it applies to all callers, including
-- the service-role used by the indexer.
--
-- Ledger account naming convention (documented here, not enforced in SQL):
--   buyer:<wallet_address>           — buyer's economic outflow account
--   escrow:<escrow_id>              — funds held in the escrow contract
--   supplier:<wallet_address>        — supplier's economic inflow account
--   protocol_fee:<recipient_address> — protocol fee collection account
--
-- For every group of ledger entries written together (same on-chain event):
--   SUM(debit) == SUM(credit)  — enforced at application layer (indexer).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper: append-only trigger function
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION prevent_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'Table "%" is append-only — UPDATE and DELETE are not permitted. '
    'Each row is an immutable record tied to an on-chain event.',
    TG_TABLE_NAME;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. organizations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.organizations (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  -- 'buyer' | 'supplier' | 'platform'
  role       TEXT        NOT NULL CHECK (role IN ('buyer', 'supplier', 'platform')),
  -- ISO 3166-1 alpha-2 country code of the organisation's legal registration
  country    TEXT        NOT NULL,
  -- Primary wallet address used for on-chain interactions (nullable until configured)
  wallet_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. users
-- ---------------------------------------------------------------------------
-- users.id == auth.uid() — Supabase auth UUID is used as the PK so RLS
-- policies can reference auth.uid() directly.

CREATE TABLE IF NOT EXISTS public.users (
  id              UUID        PRIMARY KEY,  -- matches auth.uid()
  organization_id UUID        NOT NULL REFERENCES public.organizations(id),
  email           TEXT        NOT NULL UNIQUE,
  -- 'cfo' | 'procurement' | 'supplier_contact' | 'admin'
  role            TEXT        NOT NULL
                  CHECK (role IN ('cfo', 'procurement', 'supplier_contact', 'admin')),
  -- Optional individual wallet (may differ from the organisation wallet)
  wallet_address  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Helper function: current user's organisation id
-- SECURITY DEFINER so it bypasses RLS on the users table.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auth_org_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT organization_id FROM public.users WHERE id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- 3. suppliers
-- ---------------------------------------------------------------------------
-- A supplier is represented per buyer organisation (a supplier may trade with
-- multiple buyers; each buyer maintains their own KYB record).

CREATE TABLE IF NOT EXISTS public.suppliers (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_organization_id       UUID        NOT NULL REFERENCES public.organizations(id),
  legal_name                  TEXT        NOT NULL,
  registration_number         TEXT        NOT NULL,
  -- ISO 3166-1 alpha-2 country code
  registration_country        TEXT        NOT NULL,
  -- Supplier's receiving wallet for USDC
  wallet_address              TEXT        NOT NULL,
  -- 'pending' | 'verified' | 'revoked' | 'expired'
  kyb_status                  TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (kyb_status IN ('pending','verified','revoked','expired')),
  -- bytes32 hex anchor stored in SupplierRegistry on-chain; null until KYB passes
  onchain_credential_hash     TEXT,
  -- Unix timestamp of on-chain credential expiry; 0 = no expiry; null = not set
  onchain_credential_expiry   BIGINT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 4. transactions
-- ---------------------------------------------------------------------------
-- Mirrors on-chain Escrow records. The indexer keeps this table in sync;
-- the chain is always the source of truth for funds.

CREATE TABLE IF NOT EXISTS public.transactions (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- uint256 escrow ID stored as text to avoid JS integer overflow
  escrow_id             TEXT        NOT NULL UNIQUE,
  buyer_organization_id UUID        NOT NULL REFERENCES public.organizations(id),
  supplier_id           UUID        NOT NULL REFERENCES public.suppliers(id),
  -- Clean USDC amount supplier receives (fee excluded), atomic units (6 decimals)
  amount                TEXT        NOT NULL,
  -- Protocol fee charged at funding, in USDC atomic units
  fee                   TEXT        NOT NULL,
  -- ISO 4217; always 'USDC' for the on-chain leg
  currency              TEXT        NOT NULL DEFAULT 'USDC',
  -- Current mirror of on-chain EscrowState
  state                 TEXT        NOT NULL DEFAULT 'Created'
                        CHECK (state IN
                          ('Created','Funded','Shipped','PartialReleased',
                           'Completed','Disputed','Resolved')),
  -- On-chain addresses snapshotted at escrow creation
  token_address         TEXT        NOT NULL,
  escrow_address        TEXT        NOT NULL,
  oracle_address        TEXT        NOT NULL,
  arbitrator_address    TEXT        NOT NULL,
  -- FX rate applied at funding (for CFO reporting); currency-agnostic
  fx_rate_source_currency TEXT,     -- ISO 4217, e.g. 'MXN'
  fx_rate               TEXT,       -- decimal string, e.g. '0.053' (USDC per 1 MXN)
  -- On-chain tx hashes
  creation_tx_hash      TEXT,
  funding_tx_hash       TEXT,
  -- Per-state timestamps
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  funded_at             TIMESTAMPTZ,
  shipped_at            TIMESTAMPTZ,
  partial_released_at   TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 5. milestones
-- ---------------------------------------------------------------------------
-- Mirrors the Escrow.milestones[] array. One row per milestone per transaction.

CREATE TABLE IF NOT EXISTS public.milestones (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id   UUID        NOT NULL REFERENCES public.transactions(id),
  -- 0-based position in the milestone array
  index            INTEGER     NOT NULL CHECK (index >= 0),
  -- bytes32 hex milestone type identifier (keccak256 of the label string)
  milestone_type   TEXT        NOT NULL,
  -- Percentage of total amount released at this milestone (0–100)
  pct              INTEGER     NOT NULL CHECK (pct >= 0 AND pct <= 100),
  -- 'pending' | 'released'
  state            TEXT        NOT NULL DEFAULT 'pending'
                   CHECK (state IN ('pending','released')),
  -- USDC atomic units released; null until this milestone fires
  released_amount  TEXT,
  release_tx_hash  TEXT,
  released_at      TIMESTAMPTZ,
  UNIQUE (transaction_id, index)
);

-- ---------------------------------------------------------------------------
-- 6. bills_of_lading
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.bills_of_lading (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id       UUID        NOT NULL REFERENCES public.transactions(id),
  -- bytes32 hex reference stored on-chain via confirmShipment / verifyBL
  bl_reference         TEXT        NOT NULL,
  -- Supabase storage path of the uploaded PDF/image (null = not uploaded yet)
  document_storage_path TEXT,
  -- 'pending' | 'verified' | 'rejected'
  verification_state   TEXT        NOT NULL DEFAULT 'pending'
                       CHECK (verification_state IN ('pending','verified','rejected')),
  -- Unix timestamp (seconds) of carrier-confirmed arrival; null until recorded
  arrival_timestamp    BIGINT,
  -- On-chain tx hash of the oracle's verifyBL() call
  verification_tx_hash TEXT,
  uploaded_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at          TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- 7. documents
-- ---------------------------------------------------------------------------
-- Generic file attachments. Either transaction_id or supplier_id must be set.

CREATE TABLE IF NOT EXISTS public.documents (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id      UUID        REFERENCES public.transactions(id),
  supplier_id         UUID        REFERENCES public.suppliers(id),
  -- 'bill_of_lading' | 'kyb_document' | 'invoice' | 'other'
  type                TEXT        NOT NULL
                      CHECK (type IN ('bill_of_lading','kyb_document','invoice','other')),
  name                TEXT        NOT NULL,
  -- Supabase storage path
  storage_path        TEXT        NOT NULL,
  uploaded_by_user_id UUID        NOT NULL REFERENCES public.users(id),
  uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT doc_has_parent CHECK (
    transaction_id IS NOT NULL OR supplier_id IS NOT NULL
  )
);

-- ---------------------------------------------------------------------------
-- 8. messages
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.messages (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID        NOT NULL REFERENCES public.transactions(id),
  sender_id      UUID        NOT NULL REFERENCES public.users(id),
  body           TEXT        NOT NULL,
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 9. disputes
-- ---------------------------------------------------------------------------
-- One dispute per transaction (UNIQUE constraint).

CREATE TABLE IF NOT EXISTS public.disputes (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id     UUID        NOT NULL UNIQUE REFERENCES public.transactions(id),
  raised_by_user_id  UUID        NOT NULL REFERENCES public.users(id),
  raised_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 'open' | 'resolved'
  state              TEXT        NOT NULL DEFAULT 'open'
                     CHECK (state IN ('open','resolved')),
  reason             TEXT,
  -- USDC atomic units; null until arbitrator resolves
  buyer_split        TEXT,
  supplier_split     TEXT,
  resolution_tx_hash TEXT,
  resolved_at        TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- 10. audit_events  (append-only event log)
-- ---------------------------------------------------------------------------
-- Records every meaningful system event. The indexer writes on-chain events;
-- the web app writes off-chain actions (document uploads, messages, etc.).
-- Rows are immutable: the trigger below blocks UPDATE and DELETE.

CREATE TABLE IF NOT EXISTS public.audit_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID        REFERENCES public.transactions(id),
  supplier_id     UUID        REFERENCES public.suppliers(id),
  event_type      TEXT        NOT NULL,
  -- Ethereum address of the signing account; null for off-chain events
  actor_address   TEXT,
  -- Supabase user who performed the action; null for pure on-chain events
  actor_user_id   UUID        REFERENCES public.users(id),
  -- Set for events that originate from an on-chain transaction
  onchain_tx_hash TEXT,
  -- block_number stored as text to avoid bigint overflow in JSON
  block_number    TEXT,
  -- Arbitrary structured payload; schema varies by event_type
  data            JSONB       NOT NULL DEFAULT '{}',
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_modification();

-- ---------------------------------------------------------------------------
-- 11. ledger_entries  (double-entry accounting ledger, append-only)
-- ---------------------------------------------------------------------------
-- The accounting interpretation of every fund-affecting on-chain event.
-- For each group written together: SUM(debit) = SUM(credit).
-- Account naming: see header comment above.
-- Rows are immutable: the trigger below blocks UPDATE and DELETE.

CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id   UUID        NOT NULL REFERENCES public.transactions(id),
  -- Named account (see header for naming convention)
  account          TEXT        NOT NULL,
  -- Exactly one of debit/credit is non-zero per row; the other is '0'
  debit            TEXT        NOT NULL DEFAULT '0',   -- USDC atomic units, numeric string
  credit           TEXT        NOT NULL DEFAULT '0',   -- USDC atomic units, numeric string
  -- ISO 4217; 'USDC' for all on-chain entries in Phase 1
  currency         TEXT        NOT NULL DEFAULT 'USDC',
  -- On-chain tx hash of the originating event (links back to audit_events)
  onchain_event_ref TEXT,
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_modification();

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_users_organization       ON public.users(organization_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_buyer_org      ON public.suppliers(buyer_organization_id);
CREATE INDEX IF NOT EXISTS idx_transactions_buyer_org   ON public.transactions(buyer_organization_id);
CREATE INDEX IF NOT EXISTS idx_transactions_supplier    ON public.transactions(supplier_id);
CREATE INDEX IF NOT EXISTS idx_transactions_escrow_id   ON public.transactions(escrow_id);
CREATE INDEX IF NOT EXISTS idx_transactions_state       ON public.transactions(state);
CREATE INDEX IF NOT EXISTS idx_milestones_transaction   ON public.milestones(transaction_id);
CREATE INDEX IF NOT EXISTS idx_bols_transaction         ON public.bills_of_lading(transaction_id);
CREATE INDEX IF NOT EXISTS idx_documents_transaction    ON public.documents(transaction_id);
CREATE INDEX IF NOT EXISTS idx_documents_supplier       ON public.documents(supplier_id);
CREATE INDEX IF NOT EXISTS idx_messages_transaction     ON public.messages(transaction_id);
CREATE INDEX IF NOT EXISTS idx_disputes_transaction     ON public.disputes(transaction_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_transaction ON public.audit_events(transaction_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_supplier    ON public.audit_events(supplier_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_type        ON public.audit_events(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_events_occurred    ON public.audit_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_transaction       ON public.ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_ledger_account           ON public.ledger_entries(account);
CREATE INDEX IF NOT EXISTS idx_ledger_occurred          ON public.ledger_entries(occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- All tables use RLS. The auth_org_id() helper (SECURITY DEFINER) resolves
-- the current user's organisation without recursion.
--
-- Supplier portal policies are DEFERRED to Phase 3. In Phase 1, supplier
-- contacts access the system through the buyer's org account only.
-- Documents linked to suppliers (KYB docs) inherit the buyer's org policy.
--
-- Service role (used by the indexer / oracle) bypasses RLS entirely.
-- =============================================================================

ALTER TABLE public.organizations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.milestones      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bills_of_lading ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disputes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries  ENABLE ROW LEVEL SECURITY;

-- organizations: user sees only their own org
CREATE POLICY "org_select_own" ON public.organizations
  FOR SELECT USING (id = public.auth_org_id());

-- users: user sees only members of their own org
CREATE POLICY "user_select_own_org" ON public.users
  FOR SELECT USING (organization_id = public.auth_org_id());

-- suppliers: buyer sees their own suppliers
CREATE POLICY "supplier_select_own_org" ON public.suppliers
  FOR SELECT USING (buyer_organization_id = public.auth_org_id());

-- transactions: buyer sees their own transactions
-- DEFERRED: supplier-side read policy (Phase 3)
CREATE POLICY "tx_select_own_org" ON public.transactions
  FOR SELECT USING (buyer_organization_id = public.auth_org_id());

-- milestones: visible if the parent transaction is visible
CREATE POLICY "milestone_select_via_tx" ON public.milestones
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.id = milestones.transaction_id
        AND t.buyer_organization_id = public.auth_org_id()
    )
  );

-- bills_of_lading: visible if parent transaction is visible
CREATE POLICY "bol_select_via_tx" ON public.bills_of_lading
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.id = bills_of_lading.transaction_id
        AND t.buyer_organization_id = public.auth_org_id()
    )
  );

-- documents: visible if linked to the user's org (via transaction or supplier)
CREATE POLICY "doc_select_own_org" ON public.documents
  FOR SELECT USING (
    (
      transaction_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.transactions t
        WHERE t.id = documents.transaction_id
          AND t.buyer_organization_id = public.auth_org_id()
      )
    ) OR (
      supplier_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.suppliers s
        WHERE s.id = documents.supplier_id
          AND s.buyer_organization_id = public.auth_org_id()
      )
    )
  );

-- messages: visible if parent transaction is visible
CREATE POLICY "msg_select_via_tx" ON public.messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.id = messages.transaction_id
        AND t.buyer_organization_id = public.auth_org_id()
    )
  );

-- messages: users in the org can send messages on their transactions
CREATE POLICY "msg_insert_own_org" ON public.messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.id = messages.transaction_id
        AND t.buyer_organization_id = public.auth_org_id()
    )
  );

-- disputes: visible if parent transaction is visible
CREATE POLICY "dispute_select_via_tx" ON public.disputes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.id = disputes.transaction_id
        AND t.buyer_organization_id = public.auth_org_id()
    )
  );

-- audit_events: append-only for org members; no UPDATE/DELETE policy exists
CREATE POLICY "audit_select_own_org" ON public.audit_events
  FOR SELECT USING (
    (
      transaction_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.transactions t
        WHERE t.id = audit_events.transaction_id
          AND t.buyer_organization_id = public.auth_org_id()
      )
    ) OR (
      transaction_id IS NULL AND supplier_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.suppliers s
        WHERE s.id = audit_events.supplier_id
          AND s.buyer_organization_id = public.auth_org_id()
      )
    )
  );

-- ledger_entries: read-only for org members via their transactions
-- No INSERT policy: only the service-role indexer writes ledger entries.
-- DEFERRED: direct client INSERT policy if self-service reconciliation is needed (Phase 2).
CREATE POLICY "ledger_select_own_org" ON public.ledger_entries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.id = ledger_entries.transaction_id
        AND t.buyer_organization_id = public.auth_org_id()
    )
  );
