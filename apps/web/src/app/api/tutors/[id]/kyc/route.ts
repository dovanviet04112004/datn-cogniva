/**
 * /api/tutors/[id]/kyc — upload + list KYC documents.
 *
 * GET: tutor xem các doc đã upload + status. Admin có thể xem mọi tutor.
 * POST: tutor upload doc (multipart, field 'file' + 'docType' + 'originalName').
 *
 * Sau upload, profile.verificationStatus → KYC_PENDING (chờ admin duyệt).
 * Khi admin APPROVE đủ CCCD_FRONT + CCCD_BACK + ≥1 DEGREE → KYC_VERIFIED.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

import {
  db,
  tutorKycDocument,
  tutorProfile,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin/guard';
import { getStorage } from '@/lib/storage';
import { checkLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB cho ảnh CCCD / bằng cấp
const ALLOWED_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

const DOC_TYPES = ['CCCD_FRONT', 'CCCD_BACK', 'DEGREE', 'CERTIFICATE', 'OTHER'] as const;

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const [profile] = await db
    .select({ userId: tutorProfile.userId })
    .from(tutorProfile)
    .where(eq(tutorProfile.id, id))
    .limit(1);
  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const isOwner = profile.userId === session.user.id;
  const isAdmin = isAdminEmail(session.user.email);
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const docs = await db
    .select()
    .from(tutorKycDocument)
    .where(eq(tutorKycDocument.tutorId, id))
    .orderBy(desc(tutorKycDocument.createdAt));

  return NextResponse.json({ documents: docs });
}

const DOC_TYPE_SCHEMA = z.enum(DOC_TYPES);

export async function POST(request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;
  const { id } = await params;

  const rl = await checkLimit(`kyc:${userId}`, 'upload');
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Upload quá nhiều — đợi vài phút' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } },
    );
  }

  const [profile] = await db
    .select({ userId: tutorProfile.userId })
    .from(tutorProfile)
    .where(eq(tutorProfile.id, id))
    .limit(1);
  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (profile.userId !== userId) {
    return NextResponse.json({ error: 'Chỉ chính tutor mới upload được' }, { status: 403 });
  }

  let file: File;
  let docType: string;
  let originalName: string;
  try {
    const form = await request.formData();
    const f = form.get('file');
    const dt = form.get('docType');
    const on = form.get('originalName');
    if (!(f instanceof File)) {
      return NextResponse.json({ error: '"file" thiếu' }, { status: 400 });
    }
    file = f;
    docType = typeof dt === 'string' ? dt : '';
    originalName = typeof on === 'string' ? on : f.name;
  } catch {
    return NextResponse.json({ error: 'Body phải multipart/form-data' }, { status: 400 });
  }

  const dtParsed = DOC_TYPE_SCHEMA.safeParse(docType);
  if (!dtParsed.success) {
    return NextResponse.json(
      { error: `docType phải là ${DOC_TYPES.join(' / ')}` },
      { status: 400 },
    );
  }
  if (file.size === 0 || file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `File rỗng hoặc vượt ${MAX_FILE_BYTES / (1024 * 1024)} MB` },
      { status: 400 },
    );
  }
  if (!ALLOWED_MIME.includes(file.type as (typeof ALLOWED_MIME)[number])) {
    return NextResponse.json(
      { error: `MIME ${file.type} không hỗ trợ` },
      { status: 400 },
    );
  }

  const docId = randomUUID();
  const ext = file.type === 'application/pdf' ? 'pdf'
    : file.type === 'image/jpeg' ? 'jpg'
    : file.type === 'image/png' ? 'png'
    : 'webp';
  const storageKey = `kyc/${id}/${docId}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  await getStorage().put(storageKey, buffer, file.type);

  const [created] = await db
    .insert(tutorKycDocument)
    .values({
      tutorId: id,
      docType: dtParsed.data,
      storageKey,
      mimeType: file.type,
      sizeBytes: file.size,
      originalName,
      status: 'PENDING',
    })
    .returning();

  // Chuyển profile sang KYC_PENDING nếu chưa
  await db
    .update(tutorProfile)
    .set({ verificationStatus: 'KYC_PENDING', updatedAt: new Date() })
    .where(eq(tutorProfile.id, id));

  return NextResponse.json({ document: created }, { status: 201 });
}
