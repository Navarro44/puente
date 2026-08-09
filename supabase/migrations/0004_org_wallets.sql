-- =============================================================================
-- Puente — org_wallets: explicit wallet → organization mapping
-- =============================================================================
-- Before this migration the indexer attributed on-chain events to organizations
-- by matching the buyer/supplier wallet against organizations.wallet_address,
-- and synthesised "Unregistered buyer 0x…" placeholder orgs when no match was
-- found. That produced junk rows and conflated identity with attribution.
--
-- org_wallets makes the mapping canonical and explicit:
--   • Registered during onboarding / in org settings.
--   • Read by the indexer to attribute EscrowCreated events.
--   • If a wallet is NOT registered, the indexer records the transaction with a
--     NULL org/supplier and logs a warning — it never invents an organization.
--
-- Because attribution can now be NULL, transactions.buyer_organization_id and
-- transactions.supplier_id are relaxed to NULLABLE below.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. org_wallets table
-- ---------------------------------------------------------------------------
-- wallet_address is stored lowercase so lookups are checksum-insensitive: the
-- application lowercases before insert and before every lookup.
--
-- UNIQUE (wallet_address, role): a wallet may be registered as a buyer in one
-- org and a supplier in another (distinct roles), but never twice for the same
-- role. This prevents ambiguous attribution.

CREATE TABLE IF NOT EXISTS public.org_wallets (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- EVM address, stored lowercase (see note above)
  wallet_address  TEXT        NOT NULL,
  -- 'buyer' | 'supplier'
  role            TEXT        NOT NULL CHECK (role IN ('buyer', 'supplier')),
  -- optional human-friendly label, e.g. "Operations wallet"
  label           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (wallet_address, role)
);

CREATE INDEX IF NOT EXISTS idx_org_wallets_org    ON public.org_wallets(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_wallets_wallet ON public.org_wallets(wallet_address);

-- ---------------------------------------------------------------------------
-- 2. Relax transactions attribution columns to NULLABLE
-- ---------------------------------------------------------------------------
-- The indexer must be able to record a transaction whose buyer/supplier wallet
-- is not yet registered. The chain remains the source of truth; the DB simply
-- has no org attribution until someone registers the wallet.

ALTER TABLE public.transactions ALTER COLUMN buyer_organization_id DROP NOT NULL;
ALTER TABLE public.transactions ALTER COLUMN supplier_id           DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Row Level Security
-- ---------------------------------------------------------------------------
-- A user may SELECT only their own organization's wallet registrations.
-- There is deliberately NO INSERT/UPDATE/DELETE policy: all writes go through
-- the service-role client (onboarding + settings server actions, and the
-- indexer), which bypasses RLS. The server actions validate org ownership
-- before writing. If self-service client-side writes are ever needed, add
-- WITH CHECK (organization_id = public.auth_org_id()) policies here.

ALTER TABLE public.org_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_wallets_select_own_org" ON public.org_wallets
  FOR SELECT USING (organization_id = public.auth_org_id());

-- ---------------------------------------------------------------------------
-- 4. Backfill for the currently-active Phase 1 test wallets
-- ---------------------------------------------------------------------------
-- Escrows 0/1/2 are attributed to the placeholder org
-- 14971734-f7c9-4480-9cfe-baab5084b311 (formerly "Unregistered buyer 0xb8f8…")
-- and the supplier "Test Supplier SG". We adopt that org as the real buyer org
-- and register both wallets so those escrows keep resolving after the indexer
-- stops synthesising placeholders.
--
-- The supplier-side org is read from the existing "Test Supplier SG" row rather
-- than hardcoded, per the mapping rule (attribution is keyed on the buyer's org).

DO $$
DECLARE
  v_buyer_org    UUID := '14971734-f7c9-4480-9cfe-baab5084b311';
  v_supplier_org UUID;
BEGIN
  -- Resolve the supplier-side org from what is already in the DB (do not guess).
  SELECT buyer_organization_id
    INTO v_supplier_org
    FROM public.suppliers
   WHERE legal_name = 'Test Supplier SG'
   ORDER BY created_at
   LIMIT 1;

  -- Buyer wallet → buyer org
  INSERT INTO public.org_wallets (organization_id, wallet_address, role, label)
  VALUES (
    v_buyer_org,
    lower('0xb8F8695BCa87D19462a300ef766E7208F7Fc5673'),
    'buyer',
    'Phase 1 test buyer wallet'
  )
  ON CONFLICT (wallet_address, role) DO NOTHING;

  -- Supplier wallet → supplier's org (matches suppliers."Test Supplier SG")
  IF v_supplier_org IS NOT NULL THEN
    INSERT INTO public.org_wallets (organization_id, wallet_address, role, label)
    VALUES (
      v_supplier_org,
      lower('0xf1b8f84422018d0268dc14021a6961354afdec92'),
      'supplier',
      'Phase 1 test supplier wallet'
    )
    ON CONFLICT (wallet_address, role) DO NOTHING;
  END IF;

  -- Adopt the former placeholder org as a real buyer org so escrows 0/2 no
  -- longer display an "Unregistered …" name. Only rename if it is still the
  -- indexer-synthesised placeholder (idempotent, and never clobbers a real name).
  UPDATE public.organizations
     SET name = 'Test Buyer MX',
         country = 'MX'
   WHERE id = v_buyer_org
     AND name LIKE 'Unregistered %';
END $$;
