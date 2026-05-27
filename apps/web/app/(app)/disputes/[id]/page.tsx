import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { getServiceClient } from '../../../../lib/supabase/service';
import { StateBadge } from '../../../../components/state-badge';
import { formatUsdc, formatDate, truncateAddress } from '../../../../lib/format';
import { resolveDispute } from '../../../../lib/actions/dispute';

export default async function DisputePage({ params }: { params: { id: string } }) {
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

  const { data: dispute } = await db
    .from('disputes')
    .select('*, transaction:transactions(*, supplier:suppliers(legal_name))')
    .eq('id', params.id)
    .maybeSingle();

  if (!dispute) notFound();

  const tx = dispute.transaction as {
    id: string;
    escrow_id: string;
    amount: string;
    state: string;
    supplier: { legal_name: string } | null;
  } | null;

  if (!tx) notFound();

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-2 mb-1">
        <Link href={`/transactions/${tx.id}`} className="text-sm text-gray-500 hover:text-gray-700">
          ← Transaction #{tx.escrow_id}
        </Link>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dispute</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {tx.supplier?.legal_name ?? '—'} · Escrow #{tx.escrow_id}
          </p>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
            dispute.state === 'resolved'
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-700'
          }`}
        >
          {dispute.state}
        </span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <dt className="text-xs text-gray-400">Raised at</dt>
            <dd>{formatDate(dispute.raised_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-400">Transaction amount</dt>
            <dd className="font-mono">{formatUsdc(tx.amount)}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs text-gray-400">Reason</dt>
            <dd className="mt-1 p-2 bg-gray-50 rounded text-sm">{dispute.reason ?? '—'}</dd>
          </div>
        </dl>

        {dispute.state === 'resolved' && (
          <div className="pt-4 border-t border-gray-100">
            <p className="text-sm font-semibold text-gray-700 mb-3">Resolution</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-xs text-gray-400">Buyer split</dt>
                <dd className="font-mono">{formatUsdc(dispute.buyer_split ?? '0')}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">Supplier split</dt>
                <dd className="font-mono">{formatUsdc(dispute.supplier_split ?? '0')}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400">Resolved at</dt>
                <dd>{formatDate(dispute.resolved_at)}</dd>
              </div>
              {dispute.resolution_tx_hash && (
                <div>
                  <dt className="text-xs text-gray-400">Resolution tx</dt>
                  <dd className="font-mono text-xs">{truncateAddress(dispute.resolution_tx_hash)}</dd>
                </div>
              )}
            </dl>
          </div>
        )}

        {dispute.state === 'open' && (
          <div className="pt-4 border-t border-gray-100">
            <p className="text-sm font-semibold text-gray-700 mb-1">Arbitrator Resolution</p>
            <p className="text-xs text-gray-400 mb-3">
              Uses the configured ARBITRATOR_PRIVATE_KEY. Splits must sum to the remaining balance.
            </p>
            <form action={resolveDispute} className="space-y-3">
              <input type="hidden" name="transaction_id" value={tx.id} />
              <input type="hidden" name="dispute_id" value={dispute.id} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Buyer split (USDC)
                  </label>
                  <input
                    name="buyer_split_usdc"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    placeholder="0.00"
                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Supplier split (USDC)
                  </label>
                  <input
                    name="supplier_split_usdc"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    placeholder="0.00"
                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-400">
                Remaining escrow balance: {formatUsdc(tx.amount)}
              </p>
              <button
                type="submit"
                className="bg-orange-600 hover:bg-orange-700 text-white font-medium py-2 px-4 rounded text-sm transition-colors"
              >
                Resolve Dispute on-chain
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
