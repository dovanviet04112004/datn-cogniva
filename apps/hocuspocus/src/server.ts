/**
 * Hocuspocus server — Yjs WebSocket gateway.
 *
 * Trách nhiệm:
 *   1. Authenticate connection qua JWT (sign bởi Next.js với JWT_SECRET).
 *   2. Persist Yjs binary state vào bảng `collab_doc` (Postgres).
 *   3. Multi-client sync: client A change → server merge CRDT → broadcast tới B.
 *
 * Doc name convention:
 *   - `room:{roomId}:whiteboard`  — Excalidraw shared canvas
 *   - `room:{roomId}:notes`       — TipTap collaborative document
 *   - `room:{roomId}:code`        — Monaco code editor (defer)
 *
 * JWT payload format (Next.js issue):
 *   { userId: string, roomId: string, kind: 'whiteboard'|'notes'|'code', exp: number }
 *
 * Server check: token.roomId + token.kind PHẢI match document name → tránh
 * user dùng token whiteboard để vào notes hoặc cross-room access.
 *
 * Phase 14 v1: single-instance. Multi-instance (Phase 15+) cần thêm
 * @hocuspocus/extension-redis cho pub/sub fan-out giữa các Hocuspocus container.
 */
import { Server } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import jwt from 'jsonwebtoken';
import postgres from 'postgres';

// ── Config ───────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? '1234', 10);
const JWT_SECRET = process.env.JWT_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;

if (!JWT_SECRET) {
  console.error('[hocuspocus] JWT_SECRET chưa cấu hình — exit.');
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error('[hocuspocus] DATABASE_URL chưa cấu hình — exit.');
  process.exit(1);
}

// ── DB client ────────────────────────────────────────────────
const sql = postgres(DATABASE_URL, { max: 5, prepare: false });

type DocKind = 'whiteboard' | 'notes' | 'code';

interface JwtPayload {
  userId: string;
  roomId: string;
  kind: DocKind;
  exp: number;
}

/** Parse doc name `room:{roomId}:{kind}` → {roomId, kind}. */
function parseDocName(name: string): { roomId: string; kind: DocKind } | null {
  const match = name.match(/^room:([^:]+):(whiteboard|notes|code)$/);
  if (!match) return null;
  return { roomId: match[1]!, kind: match[2] as DocKind };
}

// ── Server config ────────────────────────────────────────────
const server = Server.configure({
  port: PORT,
  timeout: 30000,

  /**
   * Authenticate: verify JWT + check roomId/kind match.
   * Throw → Hocuspocus reject connection với CloseEvent 1008 (policy violation).
   */
  async onAuthenticate({ token, documentName }: { token: string; documentName: string }) {
    if (!token) throw new Error('Missing token');

    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, JWT_SECRET as string) as JwtPayload;
    } catch (err) {
      throw new Error(`Invalid token: ${err instanceof Error ? err.message : 'unknown'}`);
    }

    const doc = parseDocName(documentName);
    if (!doc) throw new Error(`Invalid document name: ${documentName}`);
    if (doc.roomId !== payload.roomId) {
      throw new Error('Token roomId mismatch');
    }
    if (doc.kind !== payload.kind) {
      throw new Error('Token kind mismatch');
    }

    return { user: { id: payload.userId, roomId: payload.roomId } };
  },

  extensions: [
    /**
     * Persist binary Yjs state vào bảng collab_doc.
     * fetch: load khi doc lần đầu được mở.
     * store: save mỗi khi có change (Hocuspocus debounce nội bộ ~2s).
     */
    new Database({
      fetch: async ({ documentName }) => {
        const rows = await sql<{ state: string }[]>`
          SELECT state FROM collab_doc WHERE id = ${documentName} LIMIT 1
        `;
        if (rows.length === 0) return null;
        // State lưu dạng base64 → convert thành Uint8Array
        return Buffer.from(rows[0]!.state, 'base64');
      },
      store: async ({ documentName, state }) => {
        const kind = parseDocName(documentName)?.kind ?? 'whiteboard';
        const stateBase64 = Buffer.from(state).toString('base64');
        await sql`
          INSERT INTO collab_doc (id, type, state, updated_at)
          VALUES (${documentName}, ${kind.toUpperCase()}, ${stateBase64}, NOW())
          ON CONFLICT (id) DO UPDATE
          SET state = EXCLUDED.state, updated_at = NOW()
        `;
      },
    }),
  ],

  /** Log connect/disconnect cho debug. */
  async onConnect({ documentName, context }: { documentName: string; context: unknown }) {
    const ctx = context as { user?: { id: string } };
    console.log(`[hocuspocus] connect doc=${documentName} user=${ctx.user?.id ?? '?'}`);
  },

  async onDisconnect({ documentName, context }: { documentName: string; context: unknown }) {
    const ctx = context as { user?: { id: string } };
    console.log(`[hocuspocus] disconnect doc=${documentName} user=${ctx.user?.id ?? '?'}`);
  },
});

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`[hocuspocus] received ${signal}, shutting down...`);
  await server.destroy();
  await sql.end();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen();
console.log(`[hocuspocus] listening on :${PORT}`);
