import { randomBytes, scrypt } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, account, user } from '@cogniva/db';

function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      64,
      { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 },
      (err, key) => (err ? reject(err) : resolve(`${salt}:${key.toString('hex')}`)),
    );
  });
}

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
