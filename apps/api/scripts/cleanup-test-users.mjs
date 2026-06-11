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
await prisma.$executeRaw`DELETE FROM tutoring_payment WHERE booking_id IN (SELECT id FROM tutoring_booking WHERE student_id IN (SELECT id FROM "user" WHERE email LIKE ${TEST}) OR tutor_id IN (SELECT id FROM tutor_profile WHERE user_id IN (SELECT id FROM "user" WHERE email LIKE ${TEST})))`;
await prisma.$executeRaw`DELETE FROM tutor_payout WHERE tutor_id IN (SELECT id FROM tutor_profile WHERE user_id IN (SELECT id FROM "user" WHERE email LIKE ${TEST}))`;
await prisma.$executeRaw`DELETE FROM admin_audit_log WHERE admin_id IN (SELECT id FROM "user" WHERE email LIKE ${TEST})`;
await prisma.$executeRaw`DELETE FROM content_report WHERE reporter_id IN (SELECT id FROM "user" WHERE email LIKE ${TEST}) OR (target_type = 'user' AND target_id IN (SELECT id FROM "user" WHERE email LIKE ${TEST}))`;
const n = await prisma.$executeRaw`DELETE FROM "user" WHERE email LIKE ${TEST}`;
console.log(`đã xóa ${n} user test`);
await prisma.$disconnect();
