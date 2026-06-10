/**
 * Socket smoke Wave 4 — chứng minh gateway dual-accept sau nâng cấp:
 *   Gateway A (:6002, INTERNAL_API_URL=Nest :4000): connect + subscribe
 *     authorize qua endpoint Nest mới.
 *   Gateway B (:6003, INTERNAL_API_URL=hố đen): connect bằng cg_at thành công
 *     ⇔ verify JWT CỤC BỘ chạy thật (không còn đường HTTP); connect chỉ bằng
 *     cookie Better Auth legacy phải FAIL (negative control — fallback chết).
 * Chạy SAU khi 2 gateway đã được start (xem lệnh ở cuối file).
 */
import { createRequire } from 'node:module';

const webRequire = createRequire('file:///D:/DA/apps/web/package.json');
const { io } = webRequire('socket.io-client');

const NEW = 'http://localhost:4000';
const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
};

const email = `wave4-socket-${Date.now()}@test.cogniva.local`;
const r = await fetch(`${NEW}/api/auth/sign-up`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password: 'wave4-smoke-12', name: 'W4 Socket' }),
});
const cookies = r.getSetCookie ? r.getSetCookie() : r.headers.getSetCookie();
const pick = (name) => cookies.find((c) => c.startsWith(name + '='))?.split(';')[0];
const baCookie = pick('better-auth.session_token');
const atCookie = pick('cg_at');
const { user } = await r.json();
if (!baCookie || !atCookie) throw new Error('thiếu cookie sau sign-up');
console.log(`• user=${user.id} (có cg_at + BA cookie)\n`);

function connect(port, cookie, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const socket = io(`http://localhost:${port}`, {
      transports: ['websocket'],
      extraHeaders: { cookie },
      reconnection: false,
      timeout: timeoutMs,
    });
    const timer = setTimeout(() => { socket.close(); resolve({ ok: false, socket: null, err: 'timeout' }); }, timeoutMs);
    socket.on('connect', () => { clearTimeout(timer); resolve({ ok: true, socket }); });
    socket.on('connect_error', (err) => { clearTimeout(timer); socket.close(); resolve({ ok: false, socket: null, err: err.message }); });
  });
}

const subscribe = (socket, channel) =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve('timeout'), 5000);
    socket.emit('subscribe', channel, (ok) => { clearTimeout(t); resolve(ok); });
  });

// ── Gateway A (:6002 → Nest direct) ─────────────────────────────────────────
{
  const c = await connect(6002, `${atCookie}; ${baCookie}`);
  check('A: CONNECT (cg_at + BA)', c.ok, c.err ?? '');
  if (c.ok) {
    check('A: subscribe presence-user-self', (await subscribe(c.socket, `presence-user-${user.id}`)) === true);
    check('A: subscribe presence-user-other bị chặn', (await subscribe(c.socket, 'presence-user-nguoi-khac')) === false);
    check('A: subscribe channel rác bị chặn', (await subscribe(c.socket, 'kenh-rac')) === false);
    c.socket.close();
  } else { results.push(false, false, false); }
}
// Legacy-only qua gateway A (fallback HTTP → Nest dual-accept).
{
  const c = await connect(6002, baCookie);
  check('A: CONNECT chỉ BA legacy (fallback HTTP→Nest)', c.ok, c.err ?? '');
  c.socket?.close();
}

// ── Gateway B (:6003 → hố đen) — chứng minh verify cục bộ ───────────────────
{
  const c = await connect(6003, atCookie);
  check('B: CONNECT chỉ cg_at (verify CỤC BỘ, không HTTP)', c.ok, c.err ?? '');
  c.socket?.close();
}
{
  const c = await connect(6003, baCookie);
  check('B: CONNECT chỉ BA legacy FAIL (fallback chết — đúng)', !c.ok);
  c.socket?.close();
}

const pass = results.every(Boolean);
console.log(pass ? `\n✅ SOCKET SMOKE PASS (${results.length})` : `\n❌ FAIL`);
process.exit(pass ? 0 : 1);
