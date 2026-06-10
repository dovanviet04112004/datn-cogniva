/**
 * POST /api/ai/quick-gen — sinh đoạn text ngắn từ prompt cho inline AI command.
 *
 * Use case: slash command `/ai <prompt>` trong Notes (TipTap collab) → user
 * gõ xong Enter → endpoint trả về text → FE insert vào editor.
 *
 * Khác với /api/chat (streaming, conversation history): non-streaming, 1 shot,
 * giới hạn output ~500 token để không phình notes.
 *
 * Rate limit chung 'aiGenerate' (cùng với quiz gen, flashcard gen, v.v.).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { getChatModel } from '@/lib/ai/models';
import { checkLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 30;

const SCHEMA = z.object({
  prompt: z.string().min(2).max(2000),
  /** Optional context — đoạn text user đang chỉnh sửa, AI tham khảo grounding. */
  context: z.string().max(8000).optional(),
});

const SYSTEM_PROMPT = `Bạn là AI Tutor của Cogniva, hỗ trợ học sinh viết notes bài học.
Khi user gõ "/ai <yêu cầu>" trong note, bạn trả lời thẳng nội dung phù hợp để chèn vào note đó.

Quy tắc:
- Trả lời TIẾNG VIỆT (trừ khi user yêu cầu ngôn ngữ khác).
- Output thuần text/markdown đơn giản — KHÔNG markdown code fence \`\`\`, KHÔNG meta-comment ("Đây là...", "Bạn có thể...").
- Format gọn: dùng bullet "-" hoặc đánh số "1." khi list, dùng **bold** khi nhấn mạnh thuật ngữ.
- Độ dài: 50-300 từ trừ khi user yêu cầu dài hơn. Đi thẳng vào nội dung.
- Nếu user hỏi giải thích khái niệm → định nghĩa + ví dụ + lưu ý.
- Nếu user hỏi tóm tắt → bullet 3-5 ý chính.
- Nếu user hỏi so sánh → bảng markdown hoặc bullet "A vs B".`;

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  const rl = await checkLimit(`ai-quick-gen:${userId}`, 'aiGenerate');
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'AI rate limit — đợi vài giây rồi thử lại' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const userMessage = parsed.data.context
    ? `Note hiện tại:\n"""\n${parsed.data.context}\n"""\n\nYêu cầu: ${parsed.data.prompt}`
    : parsed.data.prompt;

  try {
    const { text } = await generateText({
      model: getChatModel(),
      system: SYSTEM_PROMPT,
      prompt: userMessage,
      maxTokens: 600,
      temperature: 0.4,
    });

    if (!text || text.trim().length === 0) {
      return NextResponse.json({ error: 'AI trả về rỗng' }, { status: 502 });
    }

    return NextResponse.json({ text: text.trim() });
  } catch (err) {
    console.error('[ai-quick-gen]', err);
    return NextResponse.json(
      { error: `AI lỗi: ${(err as Error).message}` },
      { status: 502 },
    );
  }
}
