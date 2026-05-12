/**
 * Reset password cho 1 user — DEV ONLY.
 *
 * Usage:
 *   cd apps/web && pnpm exec tsx --env-file=.env.local scripts/reset-password.ts <email> <newPassword>
 */
import { hashPassword } from 'better-auth/crypto';
import { and, eq } from 'drizzle-orm';
import { db, account, user } from '@cogniva/db';

const email = process.argv[2];
const newPassword = process.argv[3];
if (!email || !newPassword) {
  console.error('Usage: tsx reset-password.ts <email> <newPassword>');
  process.exit(1);
}
const EMAIL: string = email;
const PASSWORD: string = newPassword;

async function main() {
  const hashed = await hashPassword(PASSWORD);

  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, EMAIL)).limit(1);
  if (!u) {
    console.error(`No user found with email: ${email}`);
    process.exit(1);
  }

  const result = await db
    .update(account)
    .set({ password: hashed })
    .where(and(eq(account.userId, u.id), eq(account.providerId, 'credential')))
    .returning({ id: account.id });

  console.log(`Updated ${result.length} row(s)`);
  console.log(`Email:    ${EMAIL}`);
  console.log(`Password: ${PASSWORD}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('ERR', e instanceof Error ? e.message : e);
    process.exit(1);
  });
