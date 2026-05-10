/**
 * Migration runner — apply SQL migration files trong cùng folder lên DB.
 *
 * Vì sao có file này thay vì dùng drizzle-kit push?
 *   - drizzle-kit push interactive (cần TTY) — hang khi chạy qua bash
 *     background trên Windows.
 *   - Cogniva Phase 0-3 đã `db:push` được nhưng Phase 4 thêm bảng mới và
 *     drizzle-kit yêu cầu confirmation, không skip được.
 *   - Migration files SQL plain mới sạch, version-control friendly, và áp
 *     dụng được qua psql nếu cần.
 *
 * Cách dùng:
 *   pnpm --filter=@cogniva/db exec tsx --env-file=.env src/migrations/run.ts
 *
 * Lưu ý: chạy idempotent (CREATE IF NOT EXISTS) — re-run an toàn.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL chưa set');

  const sql = postgres(url, { prepare: false });
  try {
    const files = readdirSync(__dirname)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const path = resolve(__dirname, file);
      const ddl = readFileSync(path, 'utf8');
      console.log(`[migrate] applying ${file}...`);
      await sql.unsafe(ddl);
      console.log(`[migrate] ✓ ${file}`);
    }
    console.log(`[migrate] Done — ${files.length} files applied`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('[migrate] Fatal:', err);
  process.exit(1);
});
