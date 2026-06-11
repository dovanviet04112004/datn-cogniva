/**
 * POST /api/ai/quick-gen — sinh đoạn text ngắn từ prompt cho inline AI command
 * (slash command `/ai <prompt>` trong Notes TipTap). Port từ
 * apps/web/src/app/api/ai/quick-gen/route.ts.
 *
 * KHÁC bản web (deviation có chủ đích): web dùng getChatModel() legacy bypass
 * router (không guardrail/circuit/cost record); bản Nest đi qua
 * routedGenerateText useCase 'ragChat' — pick order chain (anthropic sonnet →
 * groq llama-3.3-70b) trùng getChatModel nên model thực tế KHÔNG đổi, nhưng
 * giờ có đủ guardrail + circuit breaker + ai_usage_log. Router không expose
 * temperature → temp 0.4 cũ bị bỏ. Mọi lỗi AI (kể cả guardrail deny) → 502
 * {error:'AI lỗi: ...'} như catch-all cũ.
 */
import { Body, Controller, HttpCode, HttpException, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { checkLimit } from '@cogniva/server-core/rate-limit';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/auth/session.types';
import { RouterService } from '../../infra/ai/router.service';
import type { Plan } from '../../infra/ai/cost-guardrail.service';

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

@ApiTags('ai')
@Controller('ai')
export class QuickGenController {
  constructor(private readonly router: RouterService) {}

  @Post('quick-gen')
  @HttpCode(200)
  async quickGen(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = user.id;

    // Rate-limit TRƯỚC body parse — giữ thứ tự route cũ (zod sau rate-limit).
    const rl = await checkLimit(`ai-quick-gen:${userId}`, 'aiGenerate');
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfter ?? 60));
      throw new HttpException({ error: 'AI rate limit — đợi vài giây rồi thử lại' }, 429);
    }

    const parsed = SCHEMA.safeParse(body);
    if (!parsed.success) {
      throw new HttpException({ error: parsed.error.flatten() }, 400);
    }

    const userMessage = parsed.data.context
      ? `Note hiện tại:\n"""\n${parsed.data.context}\n"""\n\nYêu cầu: ${parsed.data.prompt}`
      : parsed.data.prompt;

    let text: string;
    try {
      ({ text } = await this.router.routedGenerateText({
        useCase: 'ragChat',
        userId,
        plan: (user.plan ?? 'FREE') as Plan,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        maxOutputTokens: 600,
        feature: 'quick-gen',
      }));
    } catch (err) {
      console.error('[ai-quick-gen]', err);
      throw new HttpException({ error: `AI lỗi: ${(err as Error).message}` }, 502);
    }

    if (!text || text.trim().length === 0) {
      throw new HttpException({ error: 'AI trả về rỗng' }, 502);
    }

    return { text: text.trim() };
  }
}
