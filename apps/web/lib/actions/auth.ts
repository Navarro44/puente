'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '../supabase/server';
import { getServiceClient } from '../supabase/service';

export async function signIn(formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect('/');
}

export async function signUp(formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}&tab=signup`);
  }

  redirect('/onboard');
}

export async function signOut() {
  const supabase = createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}

export async function createProfile(formData: FormData) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const orgName = formData.get('org_name') as string;
  const orgRole = formData.get('org_role') as string;
  const orgCountry = formData.get('org_country') as string;
  const userRole = formData.get('user_role') as string;
  const walletAddress = (formData.get('wallet_address') as string) || null;

  const db = getServiceClient();

  const { data: org, error: orgErr } = await db
    .from('organizations')
    .insert({
      name: orgName,
      role: orgRole,
      country: orgCountry,
      wallet_address: walletAddress,
    })
    .select('id')
    .single();

  if (orgErr || !org) {
    redirect(`/onboard?error=${encodeURIComponent(orgErr?.message ?? 'org creation failed')}`);
  }

  const { error: userErr } = await db.from('users').insert({
    id: user.id,
    organization_id: org.id,
    email: user.email!,
    role: userRole,
    wallet_address: walletAddress,
  });

  if (userErr) {
    // Clean up org
    await db.from('organizations').delete().eq('id', org.id);
    redirect(`/onboard?error=${encodeURIComponent(userErr.message)}`);
  }

  // Optional wallet-registration step: map an on-chain wallet to this org in
  // org_wallets so the indexer can attribute future escrow events to it.
  const regWallet = ((formData.get('reg_wallet_address') as string) || '').trim().toLowerCase();
  if (regWallet) {
    const regRole = (formData.get('reg_wallet_role') as string) || orgRole;
    const regLabel = ((formData.get('reg_wallet_label') as string) || '').trim() || null;

    if (!/^0x[0-9a-f]{40}$/.test(regWallet)) {
      redirect(`/onboard?error=${encodeURIComponent('Invalid wallet address — must be a 0x-prefixed 20-byte hex address')}`);
    }
    if (regRole !== 'buyer' && regRole !== 'supplier') {
      redirect(`/onboard?error=${encodeURIComponent('Wallet role must be buyer or supplier')}`);
    }

    const { error: walletErr } = await db.from('org_wallets').insert({
      organization_id: org.id,
      wallet_address: regWallet,
      role: regRole,
      label: regLabel,
    });

    if (walletErr) {
      // The org + user are valid; surface the wallet error without tearing them
      // down so the user can retry registration from settings.
      redirect(`/onboard?error=${encodeURIComponent(`Organisation created, but wallet registration failed: ${walletErr.message}`)}`);
    }
  }

  redirect('/');
}
