/**
 * Optimistic gate only (Next 16 Proxy): app routes without an lb_session cookie are
 * redirected to /masuk. Signature + membership are verified in app/(ops)/layout.tsx,
 * route handlers and SQL — never trust this check for authorization.
 */
import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'lb_session';

export function proxy(request: NextRequest) {
  if (request.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();
  const url = new URL('/masuk', request.url);
  const next = request.nextUrl.pathname + request.nextUrl.search;
  if (next && next !== '/') url.searchParams.set('next', next);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except: '/', /masuk, /f/*, /api/*, Next internals, and files with an extension
  // (public assets, icons, images).
  matcher: ['/((?!api(?:/|$)|masuk(?:/|$)|f(?:/|$)|_next/|_vercel/|brand/|screenshots/|.*\\.[A-Za-z0-9]+$).+)'],
};
