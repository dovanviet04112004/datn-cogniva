/**
 * Cấu hình Better Auth phía server — file này KHÔNG được import từ client.
 *
 * Trách nhiệm:
 *  - Gắn Better Auth vào Drizzle adapter (postgres) để tận dụng schema có
 *    sẵn ở packages/db (bảng user/session/account/verification).
 *  - Bật email + password (autoSignIn để user đăng ký xong vào thẳng app).
 *  - Bật Google OAuth NHƯNG chỉ khi env có cả CLIENT_ID + CLIENT_SECRET —
 *    dev local thường không đặt → để Better Auth bỏ qua provider này.
 *  - Mở rộng user với cột `plan` (FREE/PRO/TEAM) — additionalFields giúp
 *    Better Auth hiểu cột Cogniva thêm vào.
 *  - Bật cookie cache 5 phút để giảm lượng query session token mỗi request
 *    (server component thường gọi getSession nhiều lần / page).
 *  - Plugin nextCookies(): cần thiết để các server action/handler set cookie
 *    đúng cách trong môi trường Next.js (RSC + middleware).
 *
 * Server component / route handler dùng:
 *   const session = await auth.api.getSession({ headers: await headers() });
 */
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { jwt } from 'better-auth/plugins/jwt';
import { bearer } from 'better-auth/plugins/bearer';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { createAuthMiddleware } from 'better-auth/api';

import { account, db, jwks, session, user, verification } from '@cogniva/db';

import { writeAudit } from '@/lib/observability/audit';
import { logger } from '@/lib/observability/logger';
import {
  validateDob,
  determineConsentStatus,
  signConsentToken,
  COPPA_AGE_THRESHOLD,
} from '@/lib/coppa';
import { redisSecondaryStorage } from '@/lib/auth-secondary-storage';

/**
 * Extract IP + UA + trace từ Better Auth context.
 * Context.request là Request standard — middleware đã set x-trace-id.
 */
function extractAuditContext(context: { request?: Request | null }): {
  ipAddress: string | null;
  userAgent: string | null;
  traceId: string | null;
} {
  const req = context.request;
  if (!req) return { ipAddress: null, userAgent: null, traceId: null };
  const xff = req.headers.get('x-forwarded-for');
  const cfIp = req.headers.get('cf-connecting-ip');
  const realIp = req.headers.get('x-real-ip');
  return {
    ipAddress: cfIp || (xff ? xff.split(',')[0]!.trim() : null) || realIp || null,
    userAgent: req.headers.get('user-agent'),
    traceId: req.headers.get('x-trace-id'),
  };
}

// Ưu tiên BETTER_AUTH_URL (thường là URL deploy production).
// Fallback NEXT_PUBLIC_APP_URL → giúp dev local chỉ cần set 1 biến.
const baseURL =
  process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export const auth = betterAuth({
  baseURL,
  // Secret để ký session token. Production BẮT BUỘC override bằng giá trị
  // sinh từ `openssl rand -base64 32`. Default chỉ để dev không crash.
  secret: process.env.BETTER_AUTH_SECRET ?? 'dev-only-secret-change-me',
  // Better Auth check `Origin` header để chống CSRF. Default chỉ trust baseURL.
  // Mobile (Expo, RN) + LAN IP testing gửi request từ origin khác → cần allowlist.
  // Production: set qua env BETTER_AUTH_TRUSTED_ORIGINS (CSV) thay vì hard-code.
  trustedOrigins: [
    'http://localhost:3000',
    'http://localhost:8081',                  // Expo Metro
    'http://192.168.*.*:3000',                // LAN IP web (wildcard subnet)
    'http://10.*.*.*:3000',
    'http://192.168.*.*:8081',                // LAN IP Expo Metro
    'http://10.*.*.*:8081',
    'exp://*',                                 // Expo Go scheme
    'cogniva://*',                             // production deep link
    'https://cogniva.com',
    'https://api.cogniva.com',
    // Dev tunnels (ngrok HTTPS) — mobile dev khi cleartext HTTP block hoặc
    // PC + phone khác Wi-Fi. Wildcard subdomain vì free tier cấp ngẫu nhiên.
    'https://*.ngrok-free.dev',
    'https://*.ngrok-free.app',
    'https://*.ngrok.io',
    'https://*.trycloudflare.com',
    ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',').map((s) => s.trim()) ?? []),
  ],
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user, session, account, verification, jwks },
  }),
  // Session lưu/đọc ở Redis (1-5ms) thay vì query Neon mỗi getSession (50-100ms warm,
  // +1-2s cold). Phủ MỌI getSession (layout/page/route/mobile) cùng lúc. Fail-open:
  // adapter trả null khi Redis lỗi → findSession fallback DB (storeSessionInDatabase=true).
  secondaryStorage: redisSecondaryStorage,
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
  },
  // Conditional spread: chỉ thêm Google nếu cả 2 env tồn tại
  // → tránh Better Auth báo lỗi cấu hình thiếu khi dev local.
  socialProviders:
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        }
      : undefined,
  user: {
    additionalFields: {
      // input: false → user không thể tự sửa plan từ form; chỉ sửa qua API
      // backend (sau khi thanh toán Stripe thành công).
      plan: {
        type: 'string',
        defaultValue: 'FREE',
        input: false,
      },
      // COPPA fields — client signup form gửi dateOfBirth + parentEmail (nếu < 13).
      // Better Auth pass thẳng vào DB row qua additionalFields.
      // Validation chạy ở user.create.before hook (reject nếu DOB invalid).
      dateOfBirth: {
        type: 'date',
        required: false, // legacy compat — Stage 1 không enforce
        input: true,
      },
      parentEmail: {
        type: 'string',
        required: false,
        input: true,
      },
      parentalConsentStatus: {
        type: 'string',
        defaultValue: 'NOT_REQUIRED',
        input: false, // server-set qua hook
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 ngày — phù hợp cho app học tập (dùng dài hạn)
    updateAge: 60 * 60 * 24, // mỗi 1 ngày refresh expiry (sliding session)
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 phút — chấp nhận trade-off latency vs accuracy
    },
    // GIỮ session trong DB SONG SONG với Redis (secondaryStorage). Tác dụng: khi Redis
    // miss/chết, Better Auth findSession tự fallback đọc DB → fail-open, KHÔNG logout
    // toàn bộ (chỉ chậm lại như trước). Cũng giữ tương thích flow cũ (bảng session vẫn dùng).
    storeSessionInDatabase: true,
  },
  /**
   * Database hooks — wire audit log cho compliance + security observability.
   * Plan v2 §15.1 W9-10. Fail-open: audit error KHÔNG block auth flow.
   */
  databaseHooks: {
    user: {
      create: {
        before: async (incomingUser) => {
          // COPPA validation: nếu form gửi dateOfBirth, validate age.
          // Legacy signup (không gửi DOB) → skip — default NOT_REQUIRED.
          const dob = (incomingUser as { dateOfBirth?: unknown }).dateOfBirth;
          const parentEmail = (incomingUser as { parentEmail?: unknown }).parentEmail;

          if (!dob) {
            // KHÔNG có DOB — accept (legacy/B2B), default NOT_REQUIRED.
            return { data: { ...incomingUser, parentalConsentStatus: 'NOT_REQUIRED' } };
          }

          const validation = validateDob(dob as Date | string);
          if (!validation.valid) {
            throw new Error(`COPPA: ${validation.reason}`);
          }

          const consent = determineConsentStatus(
            validation.age,
            typeof parentEmail === 'string' ? parentEmail : null,
          );

          // Nếu age < 13 nhưng KHÔNG có parent email → reject signup
          if (consent.status === 'PENDING' && consent.needsParentEmail) {
            throw new Error(
              'COPPA: User < 13 tuổi cần nhập email cha mẹ để gửi consent verification.',
            );
          }

          return {
            data: {
              ...incomingUser,
              dateOfBirth: typeof dob === 'string' ? new Date(dob) : dob,
              parentalConsentStatus: consent.status,
              parentEmail: typeof parentEmail === 'string' ? parentEmail : null,
            },
          };
        },
        after: async (createdUser, context) => {
          // Signup successful
          const ctx = extractAuditContext(context ?? {});
          const consentStatus =
            (createdUser as { parentalConsentStatus?: string }).parentalConsentStatus ??
            'NOT_REQUIRED';
          const parentEmail = (createdUser as { parentEmail?: string }).parentEmail;
          const dob = (createdUser as { dateOfBirth?: Date }).dateOfBirth;

          await writeAudit({
            actorId: createdUser.id,
            actorType: 'user',
            action: 'auth.signup',
            result: 'success',
            resourceType: 'user',
            resourceId: createdUser.id,
            metadata: {
              email: createdUser.email,
              hasName: !!createdUser.name,
              emailVerified: createdUser.emailVerified,
              parentalConsentStatus: consentStatus,
              hasDob: !!dob,
            },
            ...ctx,
          });
          logger.info('auth.signup', {
            user_id: createdUser.id,
            email: createdUser.email,
            parental_consent: consentStatus,
          });

          // Nếu PENDING → log consent link tới console (dev) hoặc send email (prod).
          // Email integration: Stage 2 wire Resend/Postmark. Hiện log để dev test.
          if (consentStatus === 'PENDING' && parentEmail) {
            const token = signConsentToken({
              userId: createdUser.id,
              parentEmail,
            });
            const baseUrl =
              process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
            const consentUrl = `${baseUrl}/parental-consent?token=${encodeURIComponent(token)}`;

            // TODO Stage 2: gửi email thật qua Resend/Postmark
            //   await sendEmail({ to: parentEmail, subject: 'Cogniva...', html: ... });
            logger.warn('coppa.consent_email_pending', {
              user_id: createdUser.id,
              child_email: createdUser.email,
              parent_email: parentEmail,
              consent_url: consentUrl,
              age_threshold: COPPA_AGE_THRESHOLD,
            });

            await writeAudit({
              actorId: createdUser.id,
              actorType: 'system',
              action: 'coppa.consent_email.sent',
              result: 'success',
              resourceType: 'user',
              resourceId: createdUser.id,
              metadata: { parentEmail },
              ...ctx,
            });
          }
        },
      },
    },
    session: {
      create: {
        after: async (createdSession, context) => {
          // Login successful (session create = login event)
          const ctx = extractAuditContext(context ?? {});
          await writeAudit({
            actorId: createdSession.userId,
            actorType: 'user',
            action: 'auth.login',
            result: 'success',
            resourceType: 'session',
            resourceId: createdSession.id,
            metadata: {
              sessionExpiry: createdSession.expiresAt,
            },
            ...ctx,
          });
        },
      },
      // Note: session.delete hook fire khi user signout HOẶC khi expired cleanup.
      // Để phân biệt rõ user-initiated logout, sẽ audit qua hooks.after
      // ở `/sign-out` endpoint (Stage 2 — Better Auth chưa expose endpoint hook
      // tách biệt cho user action vs cleanup).
    },
  },
  plugins: [
    /**
     * Mobile-origin plugin — inject synthetic Origin header cho request mobile.
     *
     * Vấn đề: RN Hermes fetch KHÔNG gửi Origin/Referer → Better Auth origin-check
     * fail với MISSING_OR_NULL_ORIGIN → 403.
     *
     * Vấn đề khác: bearer plugin force inject cookie context khi thấy Bearer token
     * → origin-check trigger `useCookies = true` → enforce validateOrigin.
     *
     * Solution: detect mobile request qua header `x-client-name: cogniva-mobile`
     * (apps/mobile/src/lib/api.ts set sẵn). Inject Origin = `cogniva://mobile`
     * (match trustedOrigins pattern `cogniva://*`). Web requests KHÔNG bị ảnh
     * hưởng — chúng đã có Origin browser tự set.
     *
     * Security: tách web vs mobile rõ ràng. Web vẫn full origin-check (defense
     * vs CSRF), mobile bypass (không có browser → không có CSRF vector).
     * Custom header `x-client-name` KHÔNG đủ làm trust marker — attacker có thể
     * spoof. Combine với bearer signature verify ở downstream → defense-in-depth.
     */
    {
      id: 'mobile-origin-inject',
      hooks: {
        before: [
          {
            matcher: (ctx: { request?: Request; headers?: Headers }) =>
              ctx.request?.headers.get('x-client-name')?.startsWith('cogniva-') ?? false,
            handler: createAuthMiddleware(async (c) => {
              if (!c.request) return;
              const headers = new Headers(c.request.headers);
              if (!headers.get('origin') && !headers.get('referer')) {
                const platform = c.request.headers.get('x-client-platform') ?? 'mobile';
                headers.set('origin', `cogniva://${platform}`);
              }
              return { context: { headers } };
            }),
          },
        ],
      },
    },
    /**
     * Bearer plugin (Stage 2 M4 W3) — convert Authorization: Bearer <token>
     * thành session cookie nội bộ. Mobile gửi Bearer header → Better Auth
     * tự verify signature → tạo session context → getSession() work.
     *
     * `requireSignature: true` → chỉ accept token đã ký HMAC bằng BETTER_AUTH_SECRET
     * (defense-in-depth vs token forgery).
     */
    bearer({ requireSignature: true }),
    /**
     * JWT plugin (Stage 2 M4 W3) — issue + verify JWT cho mobile + edge.
     *
     * Endpoints exposed:
     *   GET  /api/auth/jwks   — public JWK Set (edge/mobile verify)
     *   GET  /api/auth/token  — mint JWT từ current session
     *
     * Response sign-in/sign-up tự thêm header `set-auth-token` chứa JWT.
     * Mobile capture header này → lưu SecureStore → gửi Bearer subsequent calls.
     *
     * Key rotation: disabled mặc định. Stage 2 W4+ enable với rotationInterval
     * = 30 days, grace period 30 days (JWT cũ vẫn verify được sau rotate).
     */
    jwt({
      // PERF FIX: TẮT auto-đính JWT vào MỌI response /get-session. Mặc định
      // plugin có after-hook trên /get-session → mỗi getSession ký 1 JWT →
      // getJwksAdapter().getLatestKey() query `select … from jwks` (KHÔNG cache).
      // Mà mọi API route đều gọi getSession → jwks bị query MỖI REQUEST (hàng
      // chục lần/trang) → chậm + spam Neon. Web xài cookie KHÔNG cần JWT này.
      // An toàn cho mobile: token vẫn cấp qua header `set-auth-token` lúc
      // sign-in/up (capture vào SecureStore) + refresh qua GET /api/auth/token.
      disableSettingJwtHeader: true,
      jwks: {
        keyPairConfig: { alg: 'EdDSA', crv: 'Ed25519' },
      },
      jwt: {
        issuer: 'cogniva',
        audience: 'cogniva-app',
        expirationTime: '7d',
        // Payload mặc định include sub (userId), email. Thêm plan để client
        // gate feature offline (mobile) không cần API call.
        definePayload: ({ user: u }) => ({
          email: u.email,
          name: u.name,
          plan: (u as { plan?: string }).plan ?? 'FREE',
          parentalConsentStatus:
            (u as { parentalConsentStatus?: string }).parentalConsentStatus ??
            'NOT_REQUIRED',
        }),
      },
    }),
    /** nextCookies PHẢI nằm CUỐI plugin list — Better Auth doc requirement. */
    /**
     * Phase 6 — 2FA TOTP. Plugin tự thêm endpoint /two-factor/enable, /verify-totp,
     * /disable + auto-challenge khi sign-in nếu user.twoFactorEnabled. Schema có
     * sẵn user.two_factor_enabled + two_factor table (migration 0030).
     *
     * `issuer` xuất hiện trong Google Authenticator/Authy app — đẹp hơn URL.
     * `skipVerificationOnEnable=false` (default): bắt user verify 1 code trước
     * khi enable thật → tránh bị lock khi nhập sai secret QR.
     */
    twoFactor({
      issuer: 'Cogniva',
    }),
    nextCookies(),
  ],
});

/** Kiểu suy luận của session — dùng để type props server component. */
export type Session = typeof auth.$Infer.Session;
export type AuthUser = Session['user'];
