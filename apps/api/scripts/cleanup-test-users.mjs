/**
 * Dọn user test của proof/smoke (đuôi @test.cogniva.local) — cascade xóa data
 * con. Bảng library KHÔNG cascade từ user/doc (import/report) phải dọn tay
 * trước, kể cả row mồ côi từ lần proof crash giữa chừng.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const raw of readFileSync(join(apiDir, '.env'), 'utf8').split(/\r?\n/)) {
  const m = raw.match(/^([A-Z_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const prisma = new PrismaClient();
const TEST = `%@test.cogniva.local`;

await prisma.$executeRaw`DELETE FROM library_doc_import WHERE importer_id IN (SELECT id FROM "user" WHERE email LIKE ${TEST}) OR doc_id IN (SELECT id FROM library_doc WHERE uploader_id IN (SELECT id FROM "user" WHERE email LIKE ${TEST}))`;
await prisma.$executeRaw`DELETE FROM library_doc_report WHERE reporter_id IN (SELECT id FROM "user" WHERE email LIKE ${TEST}) OR doc_id IN (SELECT id FROM library_doc WHERE uploader_id IN (SELECT id FROM "user" WHERE email LIKE ${TEST}))`;
await prisma.$executeRaw`DELETE FROM library_doc WHERE uploader_id IN (SELECT id FROM "user" WHERE email LIKE ${TEST})`;
const n = await prisma.$executeRaw`DELETE FROM "user" WHERE email LIKE ${TEST}`;
console.log(`đã xóa ${n} user test`);
await prisma.$disconnect();
