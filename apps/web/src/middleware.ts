/**
 * Next.js middleware — chạy trên Edge Runtime trước khi request tới page.
 *
 * Trách nhiệm:
 *  1. Bảo vệ các route nằm trong `protectedPrefixes` — nếu không có session
 *     cookie → redirect về /sign-in kèm query `redirect=...` để sau khi
 *     login user được đẩy về đúng trang đang muốn vào.
 *  2. Khi user ĐÃ đăng nhập mà còn cố vào /sign-in hoặc /sign-up → redirect
 *     thẳng về /dashboard (tránh hiển thị form thừa).
 *
 * Lưu ý quan trọng:
 *  - Middleware chỉ kiểm tra **sự tồn tại** của session cookie qua
 *    `getSessionCookie()`. KHÔNG validate token thật vì sẽ kéo theo DB
 *    query — chậm và có thể không tương thích Edge Runtime. Validation
 *    đầy đủ chạy ở server component / route handler.
 *  - matcher loại trừ asset tĩnh + /api/auth (Better Auth tự xử lý cookie
 *    set/clear ở handler).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

// Tất cả route bắt buộc đăng nhập
const protectedPrefixes = [
  '/dashboard',
  '/workspaces',
  '/documents',
  '/chat',
  '/flashcards',
  '/quiz',
  '/graph',
  '/analytics',
  '/study-plan',
  '/settings',
];

// Route auth — đã login thì không cần xem nữa
const publicAuthPrefixes = ['/sign-in', '/sign-up'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionCookie = getSessionCookie(request);

  const isProtected = protectedPrefixes.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const isAuthRoute = publicAuthPrefixes.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  // Trường hợp 1: vào trang protected mà chưa login → đẩy về sign-in
  if (isProtected && !sessionCookie) {
    const url = new URL('/sign-in', request.url);
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }

  // Trường hợp 2: đã login mà còn xem trang sign-in/sign-up → vào dashboard
  if (isAuthRoute && sessionCookie) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

// matcher: regex Next.js dùng để quyết định middleware có chạy với path nào.
// Bỏ qua các file tĩnh (.css, .js, ảnh, font…) và route handler /api/auth/*.
export const config = {
  matcher: [
    '/((?!_next|api/auth|.*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
  ],
};
