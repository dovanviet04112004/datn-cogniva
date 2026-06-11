import type { Plan } from '../../../infra/ai/cost-guardrail.service';
import type { RouterService } from '../../../infra/ai/router.service';

const HYDE_INSTRUCTION = `Bạn là trợ lý truy hồi tài liệu. Người dùng vừa hỏi một câu, hãy viết MỘT câu trả lời ngắn (2-4 câu, dạng đoạn văn liền mạch, không bullet, không heading) GIẢ ĐỊNH như tài liệu chứa câu trả lời. Nội dung phải đặc tả khái niệm + thuật ngữ kỹ thuật + chi tiết — vì câu trả lời này sẽ được embed để search vector. Không cần đúng tuyệt đối — đúng phong cách tài liệu là quan trọng. Trả lời cùng ngôn ngữ với câu hỏi.

Câu hỏi: `;

export async function generateHypotheticalAnswer(
  router: RouterService,
  query: string,
  ctx: { userId: string; plan: Plan },
): Promise<string> {
  if (query.length < 8 || query.length > 500) return query;

  try {
    const { text } = await router.routedGenerateText({
      useCase: 'ragChat',
      userId: ctx.userId,
      plan: ctx.plan,
      messages: [{ role: 'user', content: HYDE_INSTRUCTION + query }],
      maxOutputTokens: 200,
      feature: 'hyde',
    });
    const trimmed = text.trim();
    if (!trimmed || trimmed.length < 20) return query;
    return trimmed;
  } catch (err) {
    console.warn('[hyde] LLM call failed, fallback to original query:', err);
    return query;
  }
}
