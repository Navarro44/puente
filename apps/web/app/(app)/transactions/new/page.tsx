import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { getServiceClient } from '../../../../lib/supabase/service';
import { createTransaction } from '../../../../lib/actions/transaction';
import { deployment } from '../../../../lib/deployments';

const FX_RATE = 0.053; // 1 MXN = 0.053 USDC (mock on-ramp rate)
const FEE_BPS = deployment.protocolConfig.feeBps;

export default async function NewTransactionPage({
  searchParams,
}: {
  searchParams: { error?: string; supplier_id?: string };
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
  if (profile.role !== 'procurement' && profile.role !== 'admin') redirect('/transactions');

  const { data: suppliers } = await db
    .from('suppliers')
    .select('id, legal_name, registration_country, wallet_address, kyb_status, onchain_credential_hash, onchain_credential_expiry')
    .eq('buyer_organization_id', profile.organization_id)
    .order('legal_name');

  const allSuppliers = suppliers ?? [];
  const preselectedId = searchParams.supplier_id;
  const error = searchParams.error;

  // Warn about supplier credential issues
  const getCredentialWarning = (supplier: (typeof allSuppliers)[0]) => {
    if (supplier.kyb_status === 'pending') return 'KYB not yet verified — cannot fund until verified.';
    if (supplier.kyb_status === 'revoked') return 'KYB credential revoked — cannot create transaction.';
    if (supplier.kyb_status === 'expired') return 'KYB credential expired — renew before funding.';
    if (!supplier.onchain_credential_hash) return 'No on-chain credential anchor — verify before funding.';
    const expiry = supplier.onchain_credential_expiry;
    if (expiry && Number(expiry) > 0 && Number(expiry) < Date.now() / 1000)
      return 'On-chain credential has expired — renew before funding.';
    return null;
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/transactions" className="text-sm text-gray-500 hover:text-gray-700">
          ← Transactions
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-gray-900">New Transaction</h1>
        <p className="text-sm text-gray-500 mt-1">
          Creates an on-chain escrow on Base Sepolia using USDC.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
            {decodeURIComponent(error)}
          </div>
        )}

        <form action={createTransaction} className="space-y-5">
          {/* Supplier selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
            {allSuppliers.length === 0 ? (
              <p className="text-sm text-gray-400">
                No suppliers registered.{' '}
                <Link href="/suppliers" className="text-blue-600 hover:underline">
                  Add a supplier →
                </Link>
              </p>
            ) : (
              <select
                name="supplier_id"
                required
                defaultValue={preselectedId ?? ''}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="" disabled>
                  Select a supplier…
                </option>
                {allSuppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.legal_name} ({s.registration_country}) — KYB: {s.kyb_status}
                  </option>
                ))}
              </select>
            )}

            {/* Credential warnings per supplier */}
            {allSuppliers.map((s) => {
              const warning = getCredentialWarning(s);
              if (!warning) return null;
              return (
                <div
                  key={s.id}
                  className={`mt-2 p-2 rounded text-xs ${
                    s.kyb_status === 'revoked'
                      ? 'bg-red-50 text-red-700 border border-red-200'
                      : 'bg-yellow-50 text-yellow-700 border border-yellow-200'
                  }`}
                >
                  ⚠ {s.legal_name}: {warning}
                </div>
              );
            })}
          </div>

          {/* Amount */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Amount (USDC)
            </label>
            <input
              name="amount_usdc"
              type="number"
              step="0.01"
              min="1"
              required
              placeholder="1000.00"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">
              Clean amount the supplier will receive. Protocol fee of {FEE_BPS / 100}% is added on
              top and charged at funding.
            </p>
          </div>

          {/* Milestone structure */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Milestone structure
            </label>
            <select
              name="tranche1_pct"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="30">30% on B/L verification — 70% on receipt (default)</option>
              <option value="50">50% on B/L verification — 50% on receipt</option>
              <option value="20">20% on B/L verification — 80% on receipt</option>
            </select>
          </div>

          {/* Mock FX quote */}
          <div className="bg-gray-50 rounded-md p-4 text-sm space-y-1">
            <p className="font-medium text-gray-700">Mock on-ramp quote</p>
            <p className="text-gray-500">FX rate: 1 MXN = {FX_RATE} USDC (simulated)</p>
            <p className="text-gray-500">Protocol fee: {FEE_BPS / 100}% on-chain</p>
            <p className="text-gray-400 text-xs mt-1">
              Actual USDC amount and fee confirmed once you click Create.
            </p>
          </div>

          <button
            type="submit"
            disabled={allSuppliers.length === 0}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-medium py-2 px-4 rounded-md text-sm transition-colors"
          >
            Create Transaction →
          </button>
        </form>
      </div>
    </div>
  );
}
