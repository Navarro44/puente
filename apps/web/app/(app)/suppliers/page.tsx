import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseServerClient } from '../../../lib/supabase/server';
import { getServiceClient } from '../../../lib/supabase/service';
import { formatDate, truncateAddress } from '../../../lib/format';
import { addSupplier } from './actions';

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: { error?: string; success?: string };
}) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const db = getServiceClient();
  const { data: profile } = await db
    .from('users')
    .select('role, organization_id')
    .eq('id', user.id)
    .single();
  if (!profile) redirect('/onboard');

  const { data: suppliers } = await db
    .from('suppliers')
    .select('*')
    .eq('buyer_organization_id', profile.organization_id)
    .order('legal_name');

  const allSuppliers = suppliers ?? [];
  const error = searchParams.error;
  const success = searchParams.success;

  const kybBadge = (status: string) => {
    const styles: Record<string, string> = {
      verified: 'bg-green-100 text-green-700',
      pending: 'bg-yellow-100 text-yellow-700',
      revoked: 'bg-red-100 text-red-700',
      expired: 'bg-orange-100 text-orange-700',
    };
    return (
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? 'bg-gray-100 text-gray-600'}`}
      >
        {status}
      </span>
    );
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Supplier Registry</h1>
          <p className="text-sm text-gray-500 mt-1">{allSuppliers.length} suppliers</p>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {decodeURIComponent(error)}
        </div>
      )}
      {success && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-md text-sm text-green-700">
          {decodeURIComponent(success)}
        </div>
      )}

      {/* Supplier list */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {allSuppliers.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-400">
            No suppliers registered yet. Add one below.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Name</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Country</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Wallet</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">KYB</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Credential expiry</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {allSuppliers.map((s) => {
                const isExpired =
                  s.onchain_credential_expiry &&
                  Number(s.onchain_credential_expiry) > 0 &&
                  Number(s.onchain_credential_expiry) < Date.now() / 1000;
                const canTransact = s.kyb_status === 'verified' && !isExpired;

                return (
                  <tr key={s.id} className={`hover:bg-gray-50 ${!canTransact ? 'opacity-70' : ''}`}>
                    <td className="px-6 py-3 font-medium">
                      {s.legal_name}
                      {!canTransact && (
                        <span className="ml-2 text-xs text-yellow-600">⚠</span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-gray-500">{s.registration_country}</td>
                    <td className="px-6 py-3 font-mono text-xs text-gray-500">
                      {truncateAddress(s.wallet_address)}
                    </td>
                    <td className="px-6 py-3">{kybBadge(s.kyb_status)}</td>
                    <td className="px-6 py-3 text-xs text-gray-500">
                      {s.onchain_credential_expiry && Number(s.onchain_credential_expiry) > 0
                        ? new Date(Number(s.onchain_credential_expiry) * 1000).toLocaleDateString()
                        : '—'}
                    </td>
                    <td className="px-6 py-3">
                      <Link
                        href={`/transactions/new?supplier_id=${s.id}`}
                        className={`text-xs font-medium ${
                          canTransact
                            ? 'text-blue-600 hover:underline'
                            : 'text-gray-300 cursor-not-allowed pointer-events-none'
                        }`}
                      >
                        New transaction →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Add supplier form */}
      {(profile.role === 'procurement' || profile.role === 'admin') && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Add Supplier</h2>
          <form action={addSupplier} className="space-y-4">
            <input type="hidden" name="organization_id" value={profile.organization_id} />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Legal name</label>
                <input
                  name="legal_name"
                  type="text"
                  required
                  placeholder="SinoChemicals Pte Ltd"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Registration number
                </label>
                <input
                  name="registration_number"
                  type="text"
                  required
                  placeholder="202312345A"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Country (ISO)
                </label>
                <input
                  name="registration_country"
                  type="text"
                  required
                  maxLength={2}
                  placeholder="SG"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Wallet address
                </label>
                <input
                  name="wallet_address"
                  type="text"
                  required
                  placeholder="0x…"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <p className="text-xs text-gray-400">
              KYB status defaults to &ldquo;pending&rdquo;. Manual KYB verification updates the status and
              anchors a credential in SupplierRegistry on-chain.
            </p>
            <button
              type="submit"
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md text-sm transition-colors"
            >
              Add Supplier
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
