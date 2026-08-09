import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { getServiceClient } from '../../../../lib/supabase/service';
import { registerWallet, removeWallet } from '../../../../lib/actions/wallets';
import { formatDate } from '../../../../lib/format';

export default async function WalletsSettingsPage({
  searchParams,
}: {
  searchParams: { error?: string; success?: string; wallet?: string; role?: string };
}) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const db = getServiceClient();
  const { data: profile } = await db
    .from('users')
    .select('organization_id, organization:organizations(name)')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile) redirect('/onboard');

  const { data: wallets } = await db
    .from('org_wallets')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: false });

  // Supabase types a to-one embed as an array; normalise defensively.
  const orgRel = profile.organization as unknown as { name: string } | { name: string }[] | null;
  const orgName = (Array.isArray(orgRel) ? orgRel[0]?.name : orgRel?.name) ?? '';
  const rows = wallets ?? [];

  // Pre-fill support: the "Register this wallet" button on a transaction links
  // here with ?wallet=…&role=… so the add form opens ready to submit.
  const prefillWallet = searchParams.wallet ?? '';
  const prefillRole = searchParams.role === 'supplier' ? 'supplier' : 'buyer';

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Registered wallets</h1>
        <p className="text-sm text-gray-500 mt-1">
          Wallets mapped to <span className="font-medium">{orgName}</span>. The indexer uses
          these to attribute on-chain escrow activity to your organisation.
        </p>
      </div>

      {searchParams.error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {decodeURIComponent(searchParams.error)}
        </div>
      )}
      {searchParams.success && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-md text-sm text-green-700">
          {decodeURIComponent(searchParams.success)}
        </div>
      )}

      {/* Add wallet */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Register a wallet</h2>
        <form action={registerWallet} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Wallet address</label>
            <input
              name="wallet_address"
              type="text"
              required
              defaultValue={prefillWallet}
              placeholder="0x…"
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
              <select
                name="role"
                defaultValue={prefillRole}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="buyer">Buyer</option>
                <option value="supplier">Supplier</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Label <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                name="label"
                type="text"
                placeholder="Operations wallet"
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-1.5 px-4 rounded text-sm transition-colors"
          >
            Register wallet
          </button>
        </form>
      </div>

      {/* Wallet list */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">No wallets registered yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Wallet</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Role</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Label</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Added</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((w) => (
                <tr key={w.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-mono text-xs text-gray-700">{w.wallet_address}</td>
                  <td className="px-5 py-3 capitalize">{w.role}</td>
                  <td className="px-5 py-3 text-gray-600">{w.label ?? '—'}</td>
                  <td className="px-5 py-3 text-gray-500 text-xs">{formatDate(w.created_at)}</td>
                  <td className="px-5 py-3 text-right">
                    <form action={removeWallet}>
                      <input type="hidden" name="wallet_id" value={w.id} />
                      <button
                        type="submit"
                        className="text-xs text-red-600 hover:text-red-700 hover:underline"
                      >
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
