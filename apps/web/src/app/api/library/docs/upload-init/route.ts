/**
 * POST /api/library/docs/upload-init — Library V1 (2026-05-22).
 *
 * Step 1 của upload flow: client gửi metadata file (size, hash, format) →
 * server validate + dedup hash + tạo presigned URL R2 + reserve doc record
 * (status=PROCESSING).
 *
 * Client sau đó PUT file thẳng lên R2 qua presigned URL.
 * Tiếp theo gọi POST /api/library/docs/finalize.
 *
 * Spec: docs/plans/library-share.md §Upload Flow.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, libraryDoc } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { getPresignedUploadUrl } from '@/lib/r2-client';

export const runtime = 'nodejs';

const MAX_BYTES = 20 * 1024 * 1024; // 20MB
const ALLOWED_FORMATS = ['pdf', 'docx', 'image'] as const;

const BODY = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.string().min(3),
  sizeBytes: z.number().int().positive().max(MAX_BYTES),
  /** SHA-256 hash from client (lowercase hex). */
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  format: z.enum(ALLOWED_FORMATS),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = BODY.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { contentType, sizeBytes, hash, format, filename } = parsed.data;

  // ── Dedup hash check ────────────────────────────────────────────────
  const [existing] = await db
    .select({ id: libraryDoc.id, title: libraryDoc.title })
    .from(libraryDoc)
    .where(
      and(eq(libraryDoc.fileHash, hash), eq(libraryDoc.status, 'PUBLISHED')),
    )
    .limit(1);

  if (existing) {
    return NextResponse.json(
      {
        error: 'duplicate',
        message: `Tài liệu này đã được upload với tên "${existing.title}"`,
        existingDocId: existing.id,
      },
      { status: 409 },
    );
  }

  // ── Tạo placeholder doc record (sẽ UPDATE sau khi finalize) ─────────
  const ext = inferExt(format, filename);
  // ID generate qua $defaultFn của Drizzle — INSERT trước, get id back
  const placeholder = await db
    .insert(libraryDoc)
    .values({
      uploaderId: session.user.id,
      title: filename.replace(/\.[^.]+$/, '').slice(0, 100), // tạm dùng filename, user edit sau
      subjectSlug: 'other', // tạm — finalize sẽ override
      level: 'ADULT',
      fileFormat: format,
      fileSizeBytes: sizeBytes,
      fileUrl: '', // sẽ set ở finalize
      fileHash: hash,
      status: 'PROCESSING',
    })
    .returning({ id: libraryDoc.id });

  if (!placeholder[0]) {
    return NextResponse.json({ error: 'Insert failed' }, { status: 500 });
  }
  const docId = placeholder[0].id;
  const storageKey = `lib/${session.user.id}/${docId}.${ext}`;

  // ── Generate presigned URL ─────────────────────────────────────────
  const presignedUrl = await getPresignedUploadUrl(
    storageKey,
    contentType,
    900, // 15 min
  );

  return NextResponse.json({
    docId,
    storageKey,
    presignedUrl,
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
  });
}

function inferExt(format: 'pdf' | 'docx' | 'image', filename: string): string {
  if (format === 'pdf') return 'pdf';
  if (format === 'docx') return 'docx';
  // image — preserve original extension
  const m = filename.match(/\.([a-z]{2,5})$/i);
  return m ? m[1]!.toLowerCase() : 'png';
}
