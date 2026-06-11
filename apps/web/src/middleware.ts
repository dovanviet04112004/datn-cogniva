/**
 * Next.js middleware — chạy trên Edge Runtime trước khi request tới page.
 *
 * Trách nhiệm:
 *  1. Bảo vệ các route nằm trong `protectedPrefixes` — nếu không có session
 *     cookie → redirect về /sign-in kèm query `redirect=...` để sau khi
 *     login user được đẩy về đúng trang đang muốn vào.
 *  2. Khi user ĐÃ đăng nhập mà còn cố vào /sign-in hoặc /sign-up → redirect
 *     thẳng về /dashboard (tránh hiển thị form thừa).
 *  3. Gen + propagate trace_id (W3C Trace Context) cho request correlation —
 *     header `x-trace-id` set vào cả request (forward backend) lẫn response
 *     (client thấy được để correlate Sentry replay với server log).
 *
 * Lưu ý quan trọng:
 *  - Middleware chỉ kiểm tra **sự tồn tại** của cookie JWT (`cg_at` access
 *    hoặc `cg_rt` refresh — refresh còn sống thì client tự refresh được).
 *    KHÔNG verify chữ ký ở đây — validation đầy đủ chạy ở server component
 *    (getServerSession) / route handler.
 *  - matcher loại trừ asset tĩnh + /api/auth (NestJS xử lý cookie set/clear).
 *  - trace_id reuse khi client gửi header (vd Sentry distributed tracing),
 *    chỉ gen mới nếu chưa có. Tránh fragment trace giữa client + server.
 */
import { NextResponse, type NextRequest } from 'next/server';

// Tất cả route bắt buộc đăng nhập (KHÔNG bao gồm /profile/[id] và /leaderboard
// vì public profile view có thể truy cập không login)
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

/**
 * Admin route — yêu cầu session + adminRole. Middleware chỉ check session
 * tồn tại (Edge runtime không hit DB). Authorization thật do layout server
 * component (`requireAdmin()`) + API guard (`requireAdminRole()`) đảm bảo.
 *
 * /admin/sign-in được loại trừ — public để user chưa login truy cập.
 */
const ADMIN_PREFIX = '/admin';
const ADMIN_PUBLIC_PREFIXES = ['/admin/sign-in'];

// /profile (không có id) là protected — đó là profile của chính user.
// /profile/[id] và /leaderboard là public (allow anonymous).
const exactProtected = ['/profile'];

// Route auth — đã login thì không cần xem nữa
const publicAuthPrefixes = ['/sign-in', '/sign-up'];

/**
 * Generate trace_id format `cogniva-{16hex}-{8hex}` cho dễ recognize trong log.
 * KHÔNG dùng UUID v4 vì:
 *  - Lengthy (36 char)
 *  - Khó skim eye trên log line
 *  - Edge runtime crypto.randomUUID() OK nhưng có overhead nhỏ
 */
function generateTraceId(): string {
  // crypto.getRandomValues có sẵn ở Edge runtime
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `cog-${hex.slice(0, 16)}-${hex.slice(16, 24)}`;
}

/**
 * Anti-bypass check (Stage 2 M4 W3) — production reject request KHÔNG qua edge.
 *
 * Edge gateway (Cloudflare Workers) set header `x-edge-verified=<EDGE_SHARED_SECRET>`
 * khi forward request tới origin. Nếu request hit origin trực tiếp (skip edge)
 * → KHÔNG có header → 403.
 *
 * Bypass điều kiện:
 *   - Dev / staging (NODE_ENV !== 'production')
 *   - EDGE_SHARED_SECRET KHÔNG set → coi như anti-bypass disabled
 *   - Path bắt đầu /api/health, /__health (uptime check trực tiếp Vercel)
 *
 * Production deploy: BẮT BUỘC set EDGE_SHARED_SECRET trên cả edge + origin.
 */
const ANTI_BYPASS_EXEMPT_PREFIXES = ['/api/health', '/__health'];
function checkEdgeVerified(request: NextRequest): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  const secret = process.env.EDGE_SHARED_SECRET;
  if (!secret) return true; // chưa cấu hình → skip
  const { pathname } = request.nextUrl;
  if (ANTI_BYPASS_EXEMPT_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  return request.headers.get('x-edge-verified') === secret;
}

/**
 * Phase 6 V1 impersonation enforcement.
 *
 * Khi admin start impersonate user, cookie `cogniva-imp` được set. Middleware
 * KHÔNG verify chữ ký (Node crypto không có ở Edge) — chỉ check presence.
 * Nếu cookie có + request là mutation (POST/PUT/PATCH/DELETE) → 403.
 *
 * Bypass: impersonation endpoints (`/api/admin/impersonate*`) cho phép DELETE
 * để stop impersonation. /api/auth/* không match middleware (matcher exclude).
 */
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
  // Presence-only check (JWT stack mới): có access token HOẶC refresh token
  // coi như "đang đăng nhập". Lưu ý: cg_rt bị scope path=/api/auth nên page
  // request thực tế chỉ thấy cg_at (maxAge 15') — idle quá 15' điều hướng
  // SSR sẽ về /sign-in; client còn cg_rt thì refresh xong vào lại bình thường.
  const sessionCookie =
    request.cookies.get('cg_at') ?? request.cookies.get('cg_rt') ?? null;

  // Impersonation read-only enforcement — chặn mutation khi đang impersonate.
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

  // Anti-bypass: reject 403 nếu production + secret set + KHÔNG đến từ edge.
  if (!checkEdgeVerified(request)) {
    return new NextResponse(
      JSON.stringify({
        error: 'edge_bypass_blocked',
        message: 'Direct origin access not allowed. Requests must go through edge gateway.',
      }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    );
  }

  // Reuse upstream trace_id nếu client gửi (Sentry distributed trace, curl test)
  // Khác Sentry — header này tự định nghĩa cho Cogniva, không phải W3C traceparent.
  const traceId = request.headers.get('x-trace-id') ?? generateTraceId();

  // Region tag từ edge (Stage 2 M4 W3) — forward để route handler chọn DB replica.
  // Default 'us' nếu request không qua edge (dev local hoặc anti-bypass disabled).
  const region = request.headers.get('x-cogniva-region') ?? 'us';

  const isProtected =
    exactProtected.includes(pathname) ||
    protectedPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isAuthRoute = publicAuthPrefixes.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  // Admin: chặn riêng — chưa login thì về /admin/sign-in (KHÔNG dùng chung
  // /sign-in của product để tách biệt UX). Authorization role-based do
  // layout server component xử lý.
  const isAdminRoute =
    pathname === ADMIN_PREFIX || pathname.startsWith(`${ADMIN_PREFIX}/`);
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

  // Trường hợp 1: vào trang protected mà chưa login → đẩy về sign-in
  if (isProtected && !sessionCookie) {
    const url = new URL('/sign-in', request.url);
    url.searchParams.set('redirect', pathname);
    const response = NextResponse.redirect(url);
    response.headers.set('x-trace-id', traceId);
    return response;
  }

  // Trường hợp 2: đã login mà còn xem trang sign-in/sign-up → vào dashboard
  if (isAuthRoute && sessionCookie) {
    const response = NextResponse.redirect(new URL('/dashboard', request.url));
    response.headers.set('x-trace-id', traceId);
    return response;
  }

  // Forward trace_id + region tới backend route handler qua header rewrite.
  // Route handler đọc qua `headers().get('x-trace-id')` / 'x-cogniva-region'.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-trace-id', traceId);
  requestHeaders.set('x-cogniva-region', region);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  // Set vào response để client (browser, Sentry SDK) thấy được
  response.headers.set('x-trace-id', traceId);
  response.headers.set('x-cogniva-region', region);
  return response;
}

// matcher: regex Next.js dùng để quyết định middleware có chạy với path nào.
// Bỏ qua các file tĩnh (.css, .js, ảnh, font…) và route handler /api/auth/*.
export const config = {
  matcher: [
    '/((?!_next|api/auth|.*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
  ],
};
