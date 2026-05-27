import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '../lib/supabase/server';
import { getServiceClient } from '../lib/supabase/service';

export default async function Home() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Check if profile exists
  const db = getServiceClient();
  const { data: profile } = await db
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) redirect('/onboard');

  if (profile.role === 'cfo' || profile.role === 'admin') {
    redirect('/dashboard');
  }

  redirect('/transactions');
}
