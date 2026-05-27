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

  redirect('/');
}
