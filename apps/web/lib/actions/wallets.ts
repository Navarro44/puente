'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '../supabase/server';
import { getServiceClient } from '../supabase/service';

const SETTINGS_PATH = '/settings/wallets';

/** Resolve the signed-in user's organization id, or redirect to login/onboard. */
async function requireOrgId(): Promise<string> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const db = getServiceClient();
  const { data: profile } = await db
    .from('users')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile) redirect('/onboard');
  return profile.organization_id as string;
}

/**
 * Register a wallet for the signed-in user's organization.
 *
 * Writes go through the service-role client (org_wallets has no client INSERT
 * policy); org ownership is enforced here by pinning organization_id to the
 * caller's org, never trusting a form value.
 */
export async function registerWallet(formData: FormData) {
  const orgId = await requireOrgId();

  const wallet = ((formData.get('wallet_address') as string) || '').trim().toLowerCase();
  const role = (formData.get('role') as string) || '';
  const label = ((formData.get('label') as string) || '').trim() || null;

  if (!/^0x[0-9a-f]{40}$/.test(wallet)) {
    redirect(`${SETTINGS_PATH}?error=${encodeURIComponent('Invalid wallet address — must be a 0x-prefixed 20-byte hex address')}`);
  }
  if (role !== 'buyer' && role !== 'supplier') {
    redirect(`${SETTINGS_PATH}?error=${encodeURIComponent('Role must be buyer or supplier')}`);
  }

  const db = getServiceClient();
  const { error } = await db.from('org_wallets').insert({
    organization_id: orgId,
    wallet_address: wallet,
    role,
    label,
  });

  if (error) {
    // 23505 = unique_violation on (wallet_address, role)
    const msg = error.code === '23505'
      ? `Wallet ${wallet} is already registered as a ${role}.`
      : error.message;
    redirect(`${SETTINGS_PATH}?error=${encodeURIComponent(msg)}`);
  }

  revalidatePath(SETTINGS_PATH);
  redirect(`${SETTINGS_PATH}?success=${encodeURIComponent('Wallet registered.')}`);
}

/**
 * Remove a wallet registration. Hard delete — org_wallets is a small mutable
 * mapping table (not an append-only ledger), so there is no soft-delete column;
 * removing a row simply un-registers the wallet. Existing transactions keep
 * whatever org attribution they were written with; only future indexing is
 * affected.
 */
export async function removeWallet(formData: FormData) {
  const orgId = await requireOrgId();
  const id = formData.get('wallet_id') as string;
  if (!id) redirect(`${SETTINGS_PATH}?error=${encodeURIComponent('Missing wallet id')}`);

  const db = getServiceClient();
  // Scope the delete to the caller's org so one org cannot delete another's row.
  const { error } = await db
    .from('org_wallets')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId);

  if (error) {
    redirect(`${SETTINGS_PATH}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(SETTINGS_PATH);
  redirect(`${SETTINGS_PATH}?success=${encodeURIComponent('Wallet removed.')}`);
}
