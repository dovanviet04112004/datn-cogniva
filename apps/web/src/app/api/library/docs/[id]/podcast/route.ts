/**
 * POST /api/library/docs/[id]/podcast — Bonus #9 Audio Podcast script (Phase 3).
 *
 * Generate dialogue script 2-voice (Host A + Host B) discuss doc concepts.
 * UI dùng browser Web Speech API để TTS playback → $0 cost.
 *
 * Output dialogue length ~ 1500-2500 chars (~5-7 phút audio).
 *
 * Spec: docs/plans/library-share.md §Bonus 9 NotebookLM-style.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  libraryDoc,
  libraryDocAtom,
  libraryDocChunk,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { routedGenerateText } from '@/lib/ai/router';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

const ScriptSchema = z.object({
  turns: z
    .array(
      z.object({
        speaker: z.enum(['A', 'B']),
        text: z.string().min(5).max(800),
      }),
    )
    .min(6)
    .max(30),
});

const SYSTEM_PROMPT = `Bạn là script writer cho podcast học tập 2 người dẫn (Host A + Host B), phong cách NotebookLM.

Yêu cầu:
- Host A (Linh - nữ): host chính dẫn dắt, đặt câu hỏi, ngắn gọn
- Host B (Minh - nam): expert giải thích, ví dụ cụ thể
- 12-20 turns hội thoại tự nhiên
- Mỗi turn 30-150 từ tiếng Việt
- Bắt đầu bằng intro 1-2 turn về chủ đề doc
- Kết bằng outro 1 turn rủ người nghe import doc về workspace học

Output STRICT JSON:
{
  "turns": [
    { "speaker": "A", "text": "..." },
    { "speaker": "B", "text": "..." }
  ]
}

KHÔNG markdown, KHÔNG bình luận, CHỈ JSON.`;

export async function POST(_request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  // Fetch doc context
  const [doc] = await db
    .select({
      id: libraryDoc.id,
      uploaderId: libraryDoc.uploaderId,
      title: libraryDoc.title,
      subjectSlug: libraryDoc.subjectSlug,
      aiSummary: libraryDoc.aiSummary,
      previewText: libraryDoc.previewText,
      status: libraryDoc.status,
    })
    .from(libraryDoc)
    .where(eq(libraryDoc.id, id))
    .limit(1);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (doc.status !== 'PUBLISHED') {
    return NextResponse.json({ error: 'Not available' }, { status: 403 });
  }

  // Lấy 8 atoms quan trọng nhất + 2 chunks đầu để có context
  const atoms = await db
    .select({
      text: libraryDocAtom.atomText,
      difficulty: libraryDocAtom.difficulty,
    })
    .from(libraryDocAtom)
    .where(eq(libraryDocAtom.docId, id))
    .limit(8);

  const chunks = await db
    .select({ content: libraryDocChunk.content })
    .from(libraryDocChunk)
    .where(eq(libraryDocChunk.docId, id))
    .orderBy(libraryDocChunk.pageNum, libraryDocChunk.chunkIndex)
    .limit(3);

  const atomList = atoms.length > 0
    ? atoms.map((a) => `- ${a.text}${a.difficulty ? ` (${a.difficulty})` : ''}`).join('\n')
    : '(chưa có atom)';
  const chunkText = chunks.map((c) => c.content).join('\n\n').slice(0, 2000);

  const userMsg = `Tài liệu: "${doc.title}"
Môn: ${doc.subjectSlug}

AI tóm tắt:
${doc.aiSummary ?? '(không có)'}

Atoms chính:
${atomList}

Nội dung mẫu (đoạn đầu):
${chunkText}

Viết script podcast 2 người dẫn về tài liệu này.`;

  const { text, costUsd } = await routedGenerateText({
    useCase: 'classify',
    userId: doc.uploaderId,
    plan: 'FREE',
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
    maxOutputTokens: 2500,
    feature: 'library.podcast.script',
  });

  // Parse JSON
  const jsonText = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  let parsed: z.infer<typeof ScriptSchema>;
  try {
    parsed = ScriptSchema.parse(JSON.parse(jsonText));
  } catch (err) {
    return NextResponse.json(
      { error: `Script parse fail: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    title: doc.title,
    turns: parsed.turns,
    estimatedDurationSec: Math.round(
      parsed.turns.reduce((s, t) => s + t.text.length / 15, 0), // ~15 chars/sec Vietnamese
    ),
    costUsd,
  });
}
