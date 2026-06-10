/**
 * /api/tutors/[id]/availability — PUT bulk replace.
 *
 * Simpler than CRUD per-row: client gửi full list slots, server xoá hết +
 * insert mới trong 1 transaction. Phù hợp UX matrix calendar editor.
 *
 * V2 sẽ thêm individual slot endpoints khi cần override theo ngày cụ thể.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, tutorAvailability, tutorProfile } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

const SLOT_SCHEMA = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  timezone: z.string().default('Asia/Ho_Chi_Minh'),
});

const PUT_SCHEMA = z.object({
  slots: z.array(SLOT_SCHEMA).max(50),
});

export async function PUT(request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const [profile] = await db
    .select({ userId: tutorProfile.userId })
    .from(tutorProfile)
    .where(eq(tutorProfile.id, id))
    .limit(1);
  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (profile.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = PUT_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Validate start < end mỗi slot
  for (const slot of parsed.data.slots) {
    if (slot.startTime >= slot.endTime) {
      return NextResponse.json(
        { error: `Slot ${slot.dayOfWeek}: start phải nhỏ hơn end` },
        { status: 400 },
      );
    }
  }

  // Transaction: xoá hết + insert mới
  await db.transaction(async (tx) => {
    await tx.delete(tutorAvailability).where(eq(tutorAvailability.tutorId, id));
    if (parsed.data.slots.length > 0) {
      await tx.insert(tutorAvailability).values(
        parsed.data.slots.map((s) => ({
          tutorId: id,
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
          timezone: s.timezone,
        })),
      );
    }
  });

  return NextResponse.json({ ok: true, count: parsed.data.slots.length });
}
