import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '../../lib/supabase/server';
import { createProfile } from '../../lib/actions/auth';

export default async function OnboardPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const error = searchParams.error;

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Set up your organisation</h1>
          <p className="mt-1 text-sm text-gray-500">Complete your profile to start using Puente.</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
              {decodeURIComponent(error)}
            </div>
          )}

          <form action={createProfile} className="space-y-4">
            <fieldset>
              <legend className="text-sm font-semibold text-gray-700 mb-3">Organisation</legend>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Legal name
                  </label>
                  <input
                    name="org_name"
                    type="text"
                    required
                    placeholder="Quimicos Monterrey SA de CV"
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Organisation type
                    </label>
                    <select
                      name="org_role"
                      required
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="buyer">Buyer</option>
                      <option value="supplier">Supplier</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Country (ISO)
                    </label>
                    <input
                      name="org_country"
                      type="text"
                      required
                      maxLength={2}
                      placeholder="MX"
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                    />
                  </div>
                </div>
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-sm font-semibold text-gray-700 mb-3">Your role</legend>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                  <select
                    name="user_role"
                    required
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="cfo">CFO / Finance Director</option>
                    <option value="procurement">Head of Procurement</option>
                    <option value="supplier_contact">Supplier Contact</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Wallet address{' '}
                    <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <input
                    name="wallet_address"
                    type="text"
                    placeholder="0x…"
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </fieldset>

            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md text-sm transition-colors mt-2"
            >
              Continue →
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
