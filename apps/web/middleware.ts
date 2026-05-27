import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Short-circuit before any Supabase call — these pages handle their own auth state.
  const isPublicRoute =
    pathname === '/login' ||
    pathname === '/onboard' ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico';

  if (isPublicRoute) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getSession() reads the JWT from the cookie — no outbound network call.
  // getUser() always hits /auth/v1/user to validate the JWT server-side, which
  // hangs in the Next.js Edge Runtime sandbox because the Edge Runtime's fetch
  // interceptor doesn't settle promises from middleware-initiated outbound fetches.
  // For routing purposes (redirect unauthenticated users) session presence is
  // sufficient; server components call getUser() when cryptographic validation matters.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
