import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '../../lib/supabase/server';
import { getServiceClient } from '../../lib/supabase/service';
import { Nav } from '../../components/nav';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const db = getServiceClient();
  const { data: profile } = await db
    .from('users')
    .select('role, email, organization:organizations(name)')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) redirect('/onboard');

  const orgName = (profile.organization as { name: string } | null)?.name ?? '';

  return (
    <div className="flex h-screen overflow-hidden">
      <Nav
        userName={profile.email}
        role={profile.role}
        orgName={orgName}
      />
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
