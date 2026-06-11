import fs from 'node:fs/promises';
import path from 'node:path';

import { R2Storage } from '../src/lib/storage/r2';

const UPLOADS_DIR = process.env.UPLOADS_DIR ?? path.join(process.cwd(), 'uploads');
const FORCE = process.argv.includes('--force');
const DELETE = process.argv.includes('--delete');

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

async function main() {
  const storage = new R2Storage();
  const files = await walk(UPLOADS_DIR);
  if (files.length === 0) {
    console.log(`Không có file nào trong ${UPLOADS_DIR}`);
    return;
  }
  console.log(`Tìm thấy ${files.length} file trong ${UPLOADS_DIR}\n`);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const full of files) {
    const key = path.relative(UPLOADS_DIR, full).split(path.sep).join('/');
    const ext = path.extname(full).toLowerCase();
    const contentType = MIME[ext] ?? 'application/octet-stream';

    try {
      if (!FORCE && (await storage.exists(key))) {
        console.log(`⏭️  skip (đã có): ${key}`);
        skipped++;
        continue;
      }
      const body = await fs.readFile(full);
      await storage.put(key, body, contentType);
      console.log(`✅ ${key}  (${(body.length / 1024).toFixed(0)} KB, ${contentType})`);
      uploaded++;
      if (DELETE) await fs.unlink(full);
    } catch (err) {
      console.error(`❌ FAIL ${key}:`, (err as Error).message);
      failed++;
    }
  }

  console.log(`\n— Done — uploaded=${uploaded} skipped=${skipped} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('Lỗi migrate:', e);
  process.exit(1);
});
