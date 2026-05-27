import { signIn, signUp } from '../../lib/actions/auth';

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string; tab?: string };
}) {
  const error = searchParams.error;
  const isSignup = searchParams.tab === 'signup';

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Puente</h1>
          <p className="mt-1 text-sm text-gray-500">Trade Finance on Base</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <div className="flex gap-4 mb-6">
            <a
              href="/login"
              className={`text-sm font-medium pb-1 border-b-2 transition-colors ${
                !isSignup ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'
              }`}
            >
              Sign in
            </a>
            <a
              href="/login?tab=signup"
              className={`text-sm font-medium pb-1 border-b-2 transition-colors ${
                isSignup ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'
              }`}
            >
              Create account
            </a>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
              {decodeURIComponent(error)}
            </div>
          )}

          <form action={isSignup ? signUp : signIn} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                minLength={6}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md text-sm transition-colors"
            >
              {isSignup ? 'Create account' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
