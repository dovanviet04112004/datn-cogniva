/**
 * Seed flashcards demo cho 1 user — DEV ONLY.
 *
 * Usage:
 *   cd apps/web
 *   pnpm exec tsx --env-file=.env.local scripts/seed-flashcards.ts <email>
 *
 * Tạo 8 thẻ math/CS basic với state NEW + due NOW → xuất hiện ngay trong queue.
 */
import { eq } from 'drizzle-orm';
import { db, flashcard, user } from '@cogniva/db';

const email = process.argv[2];
if (!email) {
  console.error('Usage: tsx seed-flashcards.ts <email>');
  process.exit(1);
}
const EMAIL: string = email;

const CARDS = [
  { front: 'Lim là gì?', back: 'Giá trị mà hàm tiến tới khi biến tiến tới điểm xác định.' },
  { front: 'Đạo hàm của sin(x)?', back: 'cos(x)' },
  { front: 'Đạo hàm của cos(x)?', back: '−sin(x)' },
  { front: 'Định lý Pythagoras', back: 'Trong tam giác vuông: a² + b² = c²' },
  { front: 'Big O của binary search?', back: 'O(log n)' },
  { front: 'Stack vs Queue?', back: 'Stack: LIFO (last in first out). Queue: FIFO (first in first out).' },
  { front: 'HTTP status 401 vs 403?', back: '401 = chưa xác thực (unauthenticated). 403 = đã xác thực nhưng không có quyền (forbidden).' },
  { front: 'CAP theorem 3 yếu tố?', back: 'Consistency, Availability, Partition tolerance — chỉ chọn 2/3.' },
];

async function main() {
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, EMAIL)).limit(1);
  if (!u) {
    console.error(`No user with email: ${EMAIL}`);
    process.exit(1);
  }

  // FSRS initial values cho card NEW
  const now = new Date();
  const rows = CARDS.map((c) => ({
    userId: u.id,
    cardType: 'BASIC' as const,
    front: c.front,
    back: c.back,
    state: 'NEW' as const,
    due: now,                    // tới hạn ngay
    stability: 0,
    difficulty: 5,                // mức trung bình
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
  }));

  const inserted = await db.insert(flashcard).values(rows).returning({ id: flashcard.id });
  console.log(`Inserted ${inserted.length} flashcards cho ${EMAIL}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('ERR', e instanceof Error ? e.message : e);
    process.exit(1);
  });
