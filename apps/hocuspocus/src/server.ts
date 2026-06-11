import { Server } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import jwt from 'jsonwebtoken';
import postgres from 'postgres';

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

const sql = postgres(DATABASE_URL, { max: 5, prepare: false });

type DocKind = 'whiteboard' | 'notes' | 'code';

interface JwtPayload {
  userId: string;
  roomId: string;
  kind: DocKind;
  exp: number;
}

function parseDocName(name: string): { roomId: string; kind: DocKind } | null {
  const match = name.match(/^room:([^:]+):(whiteboard|notes|code)$/);
  if (!match) return null;
  return { roomId: match[1]!, kind: match[2] as DocKind };
}

const server = Server.configure({
  port: PORT,
  timeout: 30000,

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
    new Database({
      fetch: async ({ documentName }) => {
        const rows = await sql<{ state: string }[]>`
          SELECT state FROM collab_doc WHERE id = ${documentName} LIMIT 1
        `;
        if (rows.length === 0) return null;
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

  async onConnect({ documentName, context }: { documentName: string; context: unknown }) {
    const ctx = context as { user?: { id: string } };
    console.log(`[hocuspocus] connect doc=${documentName} user=${ctx.user?.id ?? '?'}`);
  },

  async onDisconnect({ documentName, context }: { documentName: string; context: unknown }) {
    const ctx = context as { user?: { id: string } };
    console.log(`[hocuspocus] disconnect doc=${documentName} user=${ctx.user?.id ?? '?'}`);
  },
});

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
