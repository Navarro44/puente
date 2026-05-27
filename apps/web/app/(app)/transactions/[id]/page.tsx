import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { getServiceClient } from '../../../../lib/supabase/service';
import { StateBadge } from '../../../../components/state-badge';
import { MilestoneTimeline } from '../../../../components/milestone-timeline';
import { formatUsdc, formatDate, truncateAddress } from '../../../../lib/format';
import { fundTransaction, confirmShipment, confirmReceipt } from '../../../../lib/actions/transaction';
import { raiseDispute } from '../../../../lib/actions/dispute';

export default async function TransactionDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { error?: string };
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

  const { data: tx } = await db
    .from('transactions')
    .select('*, supplier:suppliers(*)')
    .eq('id', params.id)
    .maybeSingle();

  if (!tx) notFound();

  const [{ data: milestones }, { data: bols }, { data: messages }, { data: dispute }, { data: auditEvents }] =
    await Promise.all([
      db.from('milestones').select('*').eq('transaction_id', tx.id).order('index'),
      db.from('bills_of_lading').select('*').eq('transaction_id', tx.id).order('uploaded_at', { ascending: false }),
      db.from('messages').select('*, sender:users(email)').eq('transaction_id', tx.id).order('sent_at'),
      db.from('disputes').select('*').eq('transaction_id', tx.id).maybeSingle(),
      db.from('audit_events').select('*').eq('transaction_id', tx.id).order('occurred_at', { ascending: false }),
    ]);

  const supplier = tx.supplier as Record<string, string> | null;
  const bol = bols?.[0];
  const error = searchParams.error;

  // Supplier credential warning
  const kybStatus = supplier?.kyb_status ?? 'pending';
  const credentialExpiry = supplier?.onchain_credential_expiry;
  const credentialExpired =
    credentialExpiry && Number(credentialExpiry) > 0 && Number(credentialExpiry) < Date.now() / 1000;
  const showCredentialWarning = kybStatus !== 'verified' || credentialExpired;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/transactions" className="text-sm text-gray-500 hover:text-gray-700">
              ← Transactions
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            Escrow #{tx.escrow_id}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {supplier?.legal_name ?? '—'} · Created {formatDate(tx.created_at)}
          </p>
        </div>
        <StateBadge state={tx.state} />
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {decodeURIComponent(error)}
        </div>
      )}

      {showCredentialWarning && (
        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md text-sm text-yellow-700">
          ⚠ Supplier KYB credential is {credentialExpired ? 'expired' : kybStatus}. Funding may be blocked.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: details + milestones + B/L */}
        <div className="lg:col-span-2 space-y-6">
          {/* Transaction details */}
          <Section title="Details">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Detail label="Amount" value={formatUsdc(tx.amount)} />
              <Detail label="Protocol fee" value={formatUsdc(tx.fee)} />
              <Detail label="Currency" value={tx.currency} />
              <Detail label="State" value={<StateBadge state={tx.state} />} />
              <Detail label="Funded at" value={formatDate(tx.funded_at)} />
              <Detail label="Shipped at" value={formatDate(tx.shipped_at)} />
              <Detail label="Completed at" value={formatDate(tx.completed_at)} />
              <Detail label="FX rate" value={tx.fx_rate ? `${tx.fx_rate} ${tx.fx_rate_source_currency}/USDC` : '—'} />
              <Detail
                label="Escrow contract"
                value={<span className="font-mono text-xs">{truncateAddress(tx.escrow_address)}</span>}
              />
              {tx.creation_tx_hash && (
                <Detail
                  label="Creation tx"
                  value={<span className="font-mono text-xs">{truncateAddress(tx.creation_tx_hash)}</span>}
                />
              )}
            </dl>

            <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400 space-y-0.5">
              <p>Oracle: <span className="font-mono">{truncateAddress(tx.oracle_address)}</span></p>
              <p>Arbitrator: <span className="font-mono">{truncateAddress(tx.arbitrator_address)}</span></p>
            </div>
          </Section>

          {/* Milestones */}
          <Section title="Milestone timeline">
            <MilestoneTimeline milestones={milestones ?? []} />
          </Section>

          {/* B/L section */}
          <Section title="Bill of Lading">
            {bol ? (
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">{bol.bl_reference}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      bol.verification_state === 'verified'
                        ? 'bg-green-100 text-green-700'
                        : bol.verification_state === 'rejected'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}
                  >
                    {bol.verification_state}
                  </span>
                </div>
                {bol.verification_state === 'pending' && (
                  <p className="text-xs text-gray-400">
                    Oracle polls every 15 s. Arm with:{' '}
                    <code className="bg-gray-100 px-1 rounded">
                      pnpm --filter oracle arm:bl {bol.bl_reference}
                    </code>
                  </p>
                )}
                {bol.verified_at && (
                  <p className="text-xs text-gray-500">Verified at {formatDate(bol.verified_at)}</p>
                )}
                {bol.arrival_timestamp && (
                  <p className="text-xs text-gray-500">
                    Arrival recorded:{' '}
                    {new Date(Number(bol.arrival_timestamp) * 1000).toLocaleString()}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No B/L submitted yet.</p>
            )}
          </Section>

          {/* Dispute section */}
          {dispute && (
            <Section title="Dispute">
              <dl className="text-sm space-y-2">
                <Detail label="State" value={dispute.state} />
                <Detail label="Reason" value={dispute.reason ?? '—'} />
                {dispute.state === 'resolved' && (
                  <>
                    <Detail label="Buyer split" value={formatUsdc(dispute.buyer_split ?? '0')} />
                    <Detail label="Supplier split" value={formatUsdc(dispute.supplier_split ?? '0')} />
                    <Detail label="Resolved at" value={formatDate(dispute.resolved_at)} />
                  </>
                )}
              </dl>

              {dispute.state === 'open' && (
                <div className="mt-4 p-4 bg-gray-50 rounded-md border border-gray-200">
                  <p className="text-sm font-medium text-gray-700 mb-3">
                    Arbitrator resolution
                  </p>
                  <form action={resolveDisputeWithId.bind(null, params.id, dispute.id)} className="space-y-3">
                    <input type="hidden" name="transaction_id" value={params.id} />
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
                      Splits must sum to the remaining escrow balance ({formatUsdc(tx.amount)}).
                    </p>
                    <button
                      type="submit"
                      className="bg-orange-600 hover:bg-orange-700 text-white font-medium py-1.5 px-4 rounded text-sm transition-colors"
                    >
                      Resolve Dispute
                    </button>
                  </form>
                </div>
              )}
            </Section>
          )}
        </div>

        {/* Right column: actions + messages */}
        <div className="space-y-6">
          {/* Actions */}
          <Section title="Actions">
            <div className="space-y-3">
              {/* Fund */}
              {tx.state === 'Created' && (
                <form action={fundTransaction}>
                  <input type="hidden" name="transaction_id" value={tx.id} />
                  <div className="mb-2 p-3 bg-blue-50 rounded text-xs text-blue-700">
                    Funding: {formatUsdc(tx.amount)} + {formatUsdc(tx.fee)} fee = {formatUsdc((BigInt(tx.amount) + BigInt(tx.fee)).toString())} total
                  </div>
                  <button
                    type="submit"
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded text-sm transition-colors"
                  >
                    Fund Escrow
                  </button>
                </form>
              )}

              {/* Confirm Shipment */}
              {tx.state === 'Funded' && (
                <form action={confirmShipment} className="space-y-2">
                  <input type="hidden" name="transaction_id" value={tx.id} />
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      B/L Reference
                    </label>
                    <input
                      name="bl_reference"
                      type="text"
                      required
                      placeholder="MAEU-1234567890"
                      maxLength={31}
                      className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Max 31 chars. Encoded as bytes32 and submitted on-chain.
                    </p>
                  </div>
                  <button
                    type="submit"
                    className="w-full bg-yellow-500 hover:bg-yellow-600 text-white font-medium py-2 px-4 rounded text-sm transition-colors"
                  >
                    Confirm Shipment
                  </button>
                </form>
              )}

              {/* Shipped — waiting for oracle */}
              {tx.state === 'Shipped' && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-700">
                  Shipment confirmed. Oracle is polling for B/L verification.
                  {bol && (
                    <p className="mt-1 font-mono">
                      Arm: <code>pnpm --filter oracle arm:bl {bol.bl_reference}</code>
                    </p>
                  )}
                </div>
              )}

              {/* Confirm Receipt */}
              {tx.state === 'PartialReleased' && (
                <form action={confirmReceipt}>
                  <input type="hidden" name="transaction_id" value={tx.id} />
                  <div className="mb-2 p-3 bg-purple-50 rounded text-xs text-purple-700">
                    Tranche 1 (30%) released. Confirm receipt to release the remaining 70%.
                  </div>
                  <button
                    type="submit"
                    className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded text-sm transition-colors"
                  >
                    Confirm Receipt
                  </button>
                </form>
              )}

              {/* Completed / Resolved */}
              {(tx.state === 'Completed' || tx.state === 'Resolved') && (
                <div className="p-3 bg-green-50 border border-green-200 rounded text-xs text-green-700">
                  {tx.state === 'Completed'
                    ? '✓ Transaction completed. All funds released to supplier.'
                    : '✓ Dispute resolved. Funds distributed per arbitrator decision.'}
                </div>
              )}

              {/* Raise Dispute */}
              {['Funded', 'Shipped', 'PartialReleased'].includes(tx.state) && !dispute && (
                <form action={raiseDisputeAction} className="space-y-2 pt-2 border-t border-gray-100 mt-2">
                  <input type="hidden" name="transaction_id" value={tx.id} />
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Dispute reason
                    </label>
                    <textarea
                      name="reason"
                      rows={2}
                      placeholder="Describe the issue…"
                      className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded text-sm transition-colors"
                  >
                    Raise Dispute
                  </button>
                </form>
              )}
            </div>
          </Section>

          {/* Messages thread */}
          <Section title="Messages">
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {(messages ?? []).length === 0 ? (
                <p className="text-xs text-gray-400">No messages yet.</p>
              ) : (
                (messages ?? []).map((m) => (
                  <div key={m.id} className="text-sm">
                    <p className="text-xs text-gray-400 mb-0.5">
                      {(m.sender as { email: string } | null)?.email ?? 'Unknown'} ·{' '}
                      {formatDate(m.sent_at)}
                    </p>
                    <p className="text-gray-800 bg-gray-50 rounded p-2">{m.body}</p>
                  </div>
                ))
              )}
            </div>
            <MessageForm transactionId={tx.id} userId={user.id} />
          </Section>

          {/* Audit log (mini) */}
          <Section title="Audit log">
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {(auditEvents ?? []).slice(0, 10).map((ev) => (
                <div key={ev.id} className="text-xs text-gray-500">
                  <span className="font-mono">{ev.event_type}</span>
                  {ev.onchain_tx_hash && (
                    <span className="ml-1 text-gray-400">
                      · {ev.onchain_tx_hash.slice(0, 10)}…
                    </span>
                  )}
                  <br />
                  <span className="text-gray-400">{formatDate(ev.occurred_at)}</span>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

// Bound server action wrappers for dispute resolution
async function resolveDisputeWithId(txId: string, disputeId: string, formData: FormData) {
  'use server';
  const { resolveDispute } = await import('../../../../lib/actions/dispute');
  formData.set('transaction_id', txId);
  formData.set('dispute_id', disputeId);
  return resolveDispute(formData);
}

async function raiseDisputeAction(formData: FormData) {
  'use server';
  const { raiseDispute } = await import('../../../../lib/actions/dispute');
  return raiseDispute(formData);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">{title}</h2>
      {children}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className="text-sm text-gray-900">{value ?? '—'}</dd>
    </div>
  );
}

function MessageForm({ transactionId, userId }: { transactionId: string; userId: string }) {
  async function sendMessage(formData: FormData) {
    'use server';
    const db = (await import('../../../../lib/supabase/service')).getServiceClient();
    const body = formData.get('body') as string;
    if (!body?.trim()) return;
    await db.from('messages').insert({
      transaction_id: transactionId,
      sender_id: userId,
      body: body.trim(),
    });
    await db.from('audit_events').insert({
      transaction_id: transactionId,
      event_type: 'message_sent',
      actor_user_id: userId,
      data: { body: body.trim() },
    });
    const { redirect } = await import('next/navigation');
    redirect(`/transactions/${transactionId}`);
  }

  return (
    <form action={sendMessage} className="mt-3 flex gap-2">
      <input
        name="body"
        type="text"
        placeholder="Send a message…"
        className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <button
        type="submit"
        className="bg-gray-800 hover:bg-gray-900 text-white px-3 py-1.5 rounded text-sm transition-colors"
      >
        Send
      </button>
    </form>
  );
}
