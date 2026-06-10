/**
 * POST /api/library/docs/[id]/translate — Bonus #11 (Phase 3, 2026-05-27).
 *
 * Translate text payload (AI summary, preview text, hoặc atom labels) sang
 * ngôn ngữ target. Dùng LLM Router useCase='classify' (rẻ).
 *
 * Body:
 *   {
 *     target: 'vi' | 'en',
 *     text: string  // text gốc cần dịch (max 2000 char)
 *   }
 *
 * Response: { translated: string, sourceLang: string }
 *
 * Cost: ~$0.0001/req (Groq free).
 *
 * Spec: docs/plans/library-share.md §Bonus 11.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, libraryDoc } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { routedGenerateText } from '@/lib/ai/router';

export const runtime = 'nodejs';
export const maxDuration = 30;

const BODY = z.object({
  target: z.enum(['vi', 'en']),
  text: z.string().min(2).max(2000),
});

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const parsed = BODY.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Verify doc exists để tránh user spam translate API
  const [doc] = await db
    .select({
      id: libraryDoc.id,
      language: libraryDoc.language,
      status: libraryDoc.status,
    })
    .from(libraryDoc)
    .where(eq(libraryDoc.id, id))
    .limit(1);
  if (!doc) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (doc.status !== 'PUBLISHED') {
    return NextResponse.json({ error: 'Not available' }, { status: 403 });
  }

  const sourceLang = doc.language ?? 'vi';
  if (sourceLang === parsed.data.target) {
    return NextResponse.json({
      translated: parsed.data.text,
      sourceLang,
      noop: true,
    });
  }

  const targetName = parsed.data.target === 'vi' ? 'tiếng Việt' : 'English';

  const { text } = await routedGenerateText({
    useCase: 'classify',
    userId: session.user.id,
    plan: 'FREE',
    system: `Bạn là dịch giả chuyên nghiệp. Dịch chính xác sang ${targetName}.
Yêu cầu:
- Giữ nguyên ý nghĩa + thuật ngữ chuyên ngành (toán, lý, lập trình, ngôn ngữ)
- Văn phong tự nhiên, phù hợp tài liệu học tập
- KHÔNG thêm bình luận, KHÔNG markdown, CHỈ trả text đã dịch
- KHÔNG quote text gốc, KHÔNG ghi "đây là bản dịch"`,
    messages: [
      {
        role: 'user',
        content: parsed.data.text,
      },
    ],
    maxOutputTokens: 800,
    feature: 'library.translate',
  });

  return NextResponse.json({
    translated: text.trim(),
    sourceLang,
    target: parsed.data.target,
  });
}
