import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseServerClient } from '../../../lib/supabase/server';
import { getServiceClient } from '../../../lib/supabase/service';
import { StateBadge } from '../../../components/state-badge';
import { formatUsdc, formatDate, estimatedSwiftSavings } from '../../../lib/format';

export default async function DashboardPage() {
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
  if (profile.role !== 'cfo' && profile.role !== 'admin') redirect('/transactions');

  const { data: transactions } = await db
    .from('transactions')
    .select('*, supplier:suppliers(legal_name)')
    .eq('buyer_organization_id', profile.organization_id)
    .order('created_at', { ascending: false });

  const txs = transactions ?? [];

  const totalVolumeAtomic = txs.reduce((sum, tx) => sum + BigInt(tx.amount), 0n);
  const completedTxs = txs.filter((t) => t.state === 'Completed' || t.state === 'Resolved');
  const completedVolume = completedTxs.reduce((sum, tx) => sum + BigInt(tx.amount), 0n);
  const swiftSavings = estimatedSwiftSavings(completedVolume.toString());

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Finance Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Real-time view of all trade transactions</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total Volume" value={formatUsdc(totalVolumeAtomic.toString())} />
        <StatCard label="Completed Volume" value={formatUsdc(completedVolume.toString())} />
        <StatCard
          label="SWIFT Savings (est.)"
          value={formatUsdc(swiftSavings.toString())}
          sub="vs. 3.5% all-in SWIFT cost"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">All Transactions</h2>
          <a href="#audit-trail" className="text-xs text-blue-600 hover:underline">
            View audit trail ↓
          </a>
        </div>

        {txs.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-400">No transactions yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Supplier</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Amount</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">State</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">FX Rate</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Created</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {txs.map((tx) => (
                <tr key={tx.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3 font-medium">
                    {(tx.supplier as { legal_name: string } | null)?.legal_name ?? '—'}
                  </td>
                  <td className="px-6 py-3 text-right font-mono">{formatUsdc(tx.amount)}</td>
                  <td className="px-6 py-3">
                    <StateBadge state={tx.state} />
                  </td>
                  <td className="px-6 py-3 text-gray-500">
                    {tx.fx_rate ? `${tx.fx_rate} ${tx.fx_rate_source_currency}/USDC` : '—'}
                  </td>
                  <td className="px-6 py-3 text-gray-500">{formatDate(tx.created_at)}</td>
                  <td className="px-6 py-3">
                    <Link href={`/transactions/${tx.id}`} className="text-blue-600 hover:underline text-xs">
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <AuditTrail />
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

async function AuditTrail() {
  const db = getServiceClient();
  const { data: events } = await db
    .from('audit_events')
    .select('*, transaction:transactions(escrow_id)')
    .order('occurred_at', { ascending: false })
    .limit(50);

  const orgEvents = events ?? [];

  return (
    <div id="audit-trail" className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900">Audit Trail</h2>
        <p className="text-xs text-gray-500 mt-0.5">Immutable record of all platform events</p>
      </div>
      {orgEvents.length === 0 ? (
        <div className="p-8 text-center text-sm text-gray-400">No audit events yet.</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Event</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Escrow</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Tx Hash</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {orgEvents.map((ev) => (
              <tr key={ev.id} className="hover:bg-gray-50">
                <td className="px-6 py-2 font-mono text-xs">{ev.event_type}</td>
                <td className="px-6 py-2 text-gray-500 text-xs font-mono">
                  {(ev.transaction as { escrow_id: string } | null)?.escrow_id ?? '—'}
                </td>
                <td className="px-6 py-2 text-gray-500 text-xs font-mono">
                  {ev.onchain_tx_hash ? `${ev.onchain_tx_hash.slice(0, 10)}…` : '—'}
                </td>
                <td className="px-6 py-2 text-gray-500 text-xs">{formatDate(ev.occurred_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
