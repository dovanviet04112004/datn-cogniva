/**
 * Smoke CHỐT HẠ GĐ1 — thế giới JWT-thuần (Better Auth + dual-accept đã gỡ):
 * sign-up chỉ set cg_at/cg_rt, KHÔNG còn cookie better-auth; API + SSR + proxy
 * ăn cg_at; refresh rotation + reuse-detection sống; sign-out revoke.
 * Chạy qua proxy Next :3100 (đường người dùng thật đi).
 */
const WEB = 'http://localhost:3100';
const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
};

const email = `w7smoke-${Date.now()}@test.cogniva.local`;

// 1. Sign-up qua proxy — chỉ cg_* cookies
const su = await fetch(`${WEB}/api/auth/sign-up`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password: 'w7-smoke-pass-12', name: 'W7 Smoke' }),
});
const setCookies = su.headers.getSetCookie();
const cgAt = setCookies.find((c) => c.startsWith('cg_at='))?.split(';')[0];
const cgRt = setCookies.find((c) => c.startsWith('cg_rt='))?.split(';')[0];
const hasBa = setCookies.some((c) => c.includes('better-auth'));
const suBody = await su.json();
check('sign-up qua proxy → 201/200 + cg_at + cg_rt, KHÔNG cookie better-auth',
  su.ok && Boolean(cgAt) && Boolean(cgRt) && !hasBa && Boolean(suBody.accessToken),
  `status=${su.status} cookies=[${setCookies.map((c) => c.split('=')[0]).join(',')}]`);

// 2. /api/auth/me qua cookie
const me = await fetch(`${WEB}/api/auth/me`, { headers: { cookie: cgAt } });
check('GET /api/auth/me (cookie cg_at)', me.status === 200, `status=${me.status}`);

// 3. API nghiệp vụ qua proxy với cg_at (wallet — Wave 6)
const w = await fetch(`${WEB}/api/wallet`, { headers: { cookie: cgAt } });
check('GET /api/wallet qua proxy (cg_at)', w.status === 200, `status=${w.status}`);

// 4. SSR page với cg_at (shim getServerSession)
const ssr = await fetch(`${WEB}/dashboard`, { headers: { cookie: cgAt }, redirect: 'manual' });
check('SSR /dashboard (cg_at) → 200', ssr.status === 200, `status=${ssr.status}`);

// 5. Bearer token (mobile path)
const bearer = await fetch(`${WEB}/api/auth/me`, {
  headers: { authorization: `Bearer ${suBody.accessToken}` },
});
check('GET /api/auth/me (Bearer — mobile path)', bearer.status === 200, `status=${bearer.status}`);

// 6. Refresh rotation body (mobile) — token mới, token cũ bị revoke
const r1 = await fetch(`${WEB}/api/auth/refresh`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ refreshToken: suBody.refreshToken }),
});
const r1b = await r1.json();
check('POST /api/auth/refresh (body) → cặp mới', r1.status === 200 && Boolean(r1b.refreshToken), `status=${r1.status}`);
const reuse = await fetch(`${WEB}/api/auth/refresh`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ refreshToken: suBody.refreshToken }),
});
check('reuse token cũ → 401 (reuse-detection)', reuse.status === 401, `status=${reuse.status}`);

// 7. Refresh qua cookie (web silent-refresh path) — cần phiên mới (family cũ bị revoke do reuse)
const su2 = await fetch(`${WEB}/api/auth/sign-up`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: `w7smoke2-${Date.now()}@test.cogniva.local`, password: 'w7-smoke-pass-12', name: 'W7 Smoke 2' }),
});
const rt2 = su2.headers.getSetCookie().find((c) => c.startsWith('cg_rt='))?.split(';')[0];
const r2 = await fetch(`${WEB}/api/auth/refresh`, { method: 'POST', headers: { cookie: rt2 } });
check('POST /api/auth/refresh (cookie cg_rt — silent refresh web)', r2.status === 200, `status=${r2.status}`);

// 8. Sign-out + cookie cleared
const at2 = r2.headers.getSetCookie().find((c) => c.startsWith('cg_at='))?.split(';')[0];
const rt3 = r2.headers.getSetCookie().find((c) => c.startsWith('cg_rt='))?.split(';')[0];
const so = await fetch(`${WEB}/api/auth/sign-out`, {
  method: 'POST',
  headers: { cookie: `${at2}; ${rt3}`, 'content-type': 'application/json' },
  body: '{}',
});
check('POST /api/auth/sign-out → 200', so.status === 200, `status=${so.status}`);
const r3 = await fetch(`${WEB}/api/auth/refresh`, { method: 'POST', headers: { cookie: rt3 } });
check('refresh sau sign-out → 401 (revoked)', r3.status === 401, `status=${r3.status}`);

// 9. Route public vẫn public
const lb = await fetch(`${WEB}/api/leaderboard`);
check('GET /api/leaderboard (public)', lb.status === 200, `status=${lb.status}`);

const pass = results.filter(Boolean).length;
console.log(`\n══ SMOKE: ${pass}/${results.length} PASS ══`);
process.exit(pass === results.length ? 0 : 1);
