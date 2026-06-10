/** Dọn user test của proof/smoke (đuôi @test.cogniva.local) — cascade xóa data con. */
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
const n = await prisma.$executeRaw`DELETE FROM "user" WHERE email LIKE '%@test.cogniva.local'`;
console.log(`đã xóa ${n} user test`);
await prisma.$disconnect();
