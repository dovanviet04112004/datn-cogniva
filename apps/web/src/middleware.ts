import { NextResponse, type NextRequest } from 'next/server';

const protectedPrefixes = [
  '/dashboard',
  '/workspaces',
  '/documents',
  '/chat',
  '/flashcards',
  '/quiz',
  '/graph',
  '/analytics',
  '/notes',
  '/study-plan',
  '/groups',
  '/rooms',
  '/settings',
];

const ADMIN_PREFIX = '/admin';
const ADMIN_PUBLIC_PREFIXES = ['/admin/sign-in'];

const exactProtected = ['/profile'];

const publicAuthPrefixes = ['/sign-in', '/sign-up'];

function generateTraceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `cog-${hex.slice(0, 16)}-${hex.slice(16, 24)}`;
}

const ANTI_BYPASS_EXEMPT_PREFIXES = ['/api/health', '/__health'];
function checkEdgeVerified(request: NextRequest): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  const secret = process.env.EDGE_SHARED_SECRET;
  if (!secret) return true;
  const { pathname } = request.nextUrl;
  if (ANTI_BYPASS_EXEMPT_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  return request.headers.get('x-edge-verified') === secret;
}

const IMPERSONATION_COOKIE = 'cogniva-imp';
const IMPERSONATION_BYPASS_PATHS = ['/api/admin/impersonate'];
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function shouldBlockImpersonationMutation(request: NextRequest): boolean {
  if (!request.cookies.get(IMPERSONATION_COOKIE)) return false;
  if (!MUTATION_METHODS.has(request.method)) return false;
  const { pathname } = request.nextUrl;
  if (IMPERSONATION_BYPASS_PATHS.some((p) => pathname.startsWith(p))) return false;
  return true;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionCookie = request.cookies.get('cg_at') ?? request.cookies.get('cg_rt') ?? null;

  if (shouldBlockImpersonationMutation(request)) {
    return new NextResponse(
      JSON.stringify({
        error: 'impersonation_readonly',
        message:
          'Đang trong session impersonate — không được mutate. Stop impersonation ở banner top page rồi thử lại.',
      }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    );
  }

  if (!checkEdgeVerified(request)) {
    return new NextResponse(
      JSON.stringify({
        error: 'edge_bypass_blocked',
        message: 'Direct origin access not allowed. Requests must go through edge gateway.',
      }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    );
  }

  const traceId = request.headers.get('x-trace-id') ?? generateTraceId();

  const region = request.headers.get('x-cogniva-region') ?? 'us';

  const isProtected =
    exactProtected.includes(pathname) ||
    protectedPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isAuthRoute = publicAuthPrefixes.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  const isAdminRoute = pathname === ADMIN_PREFIX || pathname.startsWith(`${ADMIN_PREFIX}/`);
  const isAdminPublic = ADMIN_PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (isAdminRoute && !isAdminPublic && !sessionCookie) {
    const url = new URL('/admin/sign-in', request.url);
    url.searchParams.set('redirect', pathname);
    const response = NextResponse.redirect(url);
    response.headers.set('x-trace-id', traceId);
    return response;
  }

  if (isProtected && !sessionCookie) {
    const url = new URL('/sign-in', request.url);
    url.searchParams.set('redirect', pathname);
    const response = NextResponse.redirect(url);
    response.headers.set('x-trace-id', traceId);
    return response;
  }

  if (isAuthRoute && sessionCookie) {
    const response = NextResponse.redirect(new URL('/dashboard', request.url));
    response.headers.set('x-trace-id', traceId);
    return response;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-trace-id', traceId);
  requestHeaders.set('x-cogniva-region', region);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set('x-trace-id', traceId);
  response.headers.set('x-cogniva-region', region);
  return response;
}

export const config = {
  matcher: [
    '/((?!_next|api/auth|.*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
  ],
};
