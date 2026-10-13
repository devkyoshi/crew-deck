import { NextResponse, type NextRequest } from 'next/server';

const BASE_DOMAIN = (process.env.BASE_DOMAIN ?? 'localhost').toLowerCase();
const SESSION_COOKIE = 'cd_session';
const PUBLIC_PREFIXES = ['/sign-in', '/accept-invite', '/design', '/api'];

function tenantSlug(host: string | null) {
  if (!host) return null;
  const hostname = host.split(':')[0]!.toLowerCase();
  const suffix = `.${BASE_DOMAIN}`;
  return hostname.endsWith(suffix) ? hostname.slice(0, -suffix.length) : null;
}

/**
 * Cheap first gate: apex host (no tenant) only serves the workspace picker, and tenant pages need a
 * session cookie. The real session check happens on the server in the (app) layout.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const slug = tenantSlug(req.headers.get('host'));

  if (!slug) {
    if (pathname === '/') return NextResponse.rewrite(new URL('/workspaces', req.url));
    if (pathname.startsWith('/workspaces') || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL('/', req.url));
  }

  if (pathname.startsWith('/workspaces')) return NextResponse.redirect(new URL('/', req.url));
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isPublic && !req.cookies.get(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL('/sign-in', req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico|css|js)$).*)'],
};
