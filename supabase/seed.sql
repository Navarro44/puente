-- =============================================================================
-- Puente — seed data for local development and CI
-- =============================================================================
-- Creates:
--   • One buyer organisation (Quimex SA de CV, Mexico)
--   • One supplier organisation (Singapore ChemCo Pte Ltd)
--   • Three users: CFO, Head of Procurement (buyer side), supplier_admin
--   • One verified supplier record linked to the buyer org
--
-- NOTE: users.id must match auth.uid() in a live Supabase project.
--       For local dev with the Supabase CLI, insert into auth.users first,
--       then use the same UUIDs here. Placeholder UUIDs are used below.
--
-- Run with:   supabase db seed  (Supabase CLI)
--        or:  psql $DATABASE_URL < supabase/seed.sql
-- =============================================================================

-- Stable UUIDs for deterministic seeding (replace in production)
DO $$
DECLARE
  buyer_org_id     UUID := '11111111-1111-1111-1111-111111111111';
  supplier_org_id  UUID := '22222222-2222-2222-2222-222222222222';
  cfo_user_id      UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  proc_user_id     UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  supplier_user_id UUID := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  supplier_id      UUID := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
BEGIN

-- ---------------------------------------------------------------------------
-- Organisations
-- ---------------------------------------------------------------------------

INSERT INTO public.organizations (id, name, role, country, wallet_address)
VALUES
  (
    buyer_org_id,
    'Quimex SA de CV',
    'buyer',
    'MX',
    '0x1111111111111111111111111111111111111111'
  ),
  (
    supplier_org_id,
    'Singapore ChemCo Pte Ltd',
    'supplier',
    'SG',
    '0x2222222222222222222222222222222222222222'
  )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
-- In a live Supabase project these users must first be created via
-- supabase.auth.admin.createUser() so auth.users rows exist.
-- For local dev the Supabase CLI seed runner handles auth.users separately.

INSERT INTO public.users (id, organization_id, email, role, wallet_address)
VALUES
  (
    cfo_user_id,
    buyer_org_id,
    'cfo@quimex.example',
    'cfo',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  ),
  (
    proc_user_id,
    buyer_org_id,
    'procurement@quimex.example',
    'procurement',
    '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  ),
  (
    supplier_user_id,
    supplier_org_id,
    'admin@singchemco.example',
    'supplier_contact',
    '0xcccccccccccccccccccccccccccccccccccccccc'
  )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Supplier record
-- ---------------------------------------------------------------------------
-- This is the buyer-relative view of the supplier. KYB has been approved;
-- the credential hash is a keccak256 anchor of the off-chain KYB bundle.

INSERT INTO public.suppliers (
  id,
  buyer_organization_id,
  legal_name,
  registration_number,
  registration_country,
  wallet_address,
  kyb_status,
  onchain_credential_hash,
  onchain_credential_expiry
)
VALUES (
  supplier_id,
  buyer_org_id,
  'Singapore ChemCo Pte Ltd',
  '202312345K',          -- Singapore ACRA registration number (example)
  'SG',
  '0x2222222222222222222222222222222222222222',
  'verified',
  -- keccak256("kyb-seed-credential-singapore-chemco-v1") — placeholder hash
  '0x4b6f796c655f6b796200000000000000000000000000000000000000000000000',
  0                      -- 0 = no expiry
)
ON CONFLICT (id) DO NOTHING;

END $$;
