import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseServerClient } from '../../../lib/supabase/server';
import { getServiceClient } from '../../../lib/supabase/service';
import { StateBadge } from '../../../components/state-badge';
import { formatUsdc, formatDate } from '../../../lib/format';

export default async function TransactionsPage() {
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

  const { data: transactions } = await db
    .from('transactions')
    .select('*, supplier:suppliers(legal_name)')
    .eq('buyer_organization_id', profile.organization_id)
    .order('created_at', { ascending: false });

  const txs = transactions ?? [];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Transactions</h1>
          <p className="text-sm text-gray-500 mt-1">{txs.length} total</p>
        </div>
        {(profile.role === 'procurement' || profile.role === 'admin') && (
          <Link
            href="/transactions/new"
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md text-sm transition-colors"
          >
            + New Transaction
          </Link>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {txs.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-gray-400">No transactions yet.</p>
            {(profile.role === 'procurement' || profile.role === 'admin') && (
              <Link href="/transactions/new" className="mt-3 inline-block text-sm text-blue-600 hover:underline">
                Create your first transaction →
              </Link>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Escrow ID</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Supplier</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Amount</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">State</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Created</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {txs.map((tx) => (
                <tr key={tx.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3 font-mono text-xs text-gray-500">#{tx.escrow_id}</td>
                  <td className="px-6 py-3 font-medium">
                    {(tx.supplier as { legal_name: string } | null)?.legal_name ?? '—'}
                  </td>
                  <td className="px-6 py-3 text-right font-mono">{formatUsdc(tx.amount)}</td>
                  <td className="px-6 py-3">
                    <StateBadge state={tx.state} />
                  </td>
                  <td className="px-6 py-3 text-gray-500 text-xs">{formatDate(tx.created_at)}</td>
                  <td className="px-6 py-3">
                    <Link
                      href={`/transactions/${tx.id}`}
                      className="text-blue-600 hover:underline text-xs font-medium"
                    >
                      View →
                    </Link>
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
