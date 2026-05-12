/**
 * GET /api/debug/router-test — debug endpoint test LLM router fallback chain.
 *
 * CHỈ chạy ở dev (NODE_ENV !== 'production'). Production trả 404.
 *
 * Note path: dùng `debug` (không `_debug`) — Next.js App Router exclude
 * folder underscore-prefix khỏi routing (private folder convention).
 *
 * Test paths:
 *   GET ?ok=1            — happy path, default route 'classify' (Haiku)
 *   GET ?circuit_open=1  — simulate circuit open bằng cách trigger 5 fail
 *                           liên tiếp trên model invalid
 *   GET ?quota=1         — check cost guardrail (cần userId qua session)
 *   GET ?fallback=1      — force primary fail → verify fallback chain hit
 *
 * Để test fallback chain real:
 *   1. Tạm comment ANTHROPIC_API_KEY trong .env.local
 *   2. Restart dev server
 *   3. curl /api/_debug/router-test?ok=1 → phải trả từ OpenRouter
 *   4. Restore key
 *
 * Logs để check:
 *   - logger.info('ai-router.completed') với provider used
 *   - logger.warn('ai-router.circuit_open_skip') nếu fallback hit
 *   - logger.warn('ai-router.provider_failed') nếu primary fail
 */
import { headers } from 'next/headers';

import { auth } from '@/lib/auth';
import { routedGenerateText, CostGuardrailError, AllProvidersFailedError } from '@/lib/ai/router';
import { getUserDailyUsage, type Plan } from '@/lib/observability/cost-guardrail';
import { getCircuitState } from '@/lib/ai/circuit-breaker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Production: 404 ngay
  if (process.env.NODE_ENV === 'production') {
    return new Response('Not found', { status: 404 });
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized — login first' }, { status: 401 });
  }

  const userId = session.user.id;
  const plan = ((session.user as { plan?: string }).plan ?? 'FREE') as Plan;
  const { searchParams } = new URL(req.url);

  // ── Mode 1: quota check (read-only) ─────────────────────
  if (searchParams.get('quota') === '1') {
    const usage = await getUserDailyUsage(userId, plan);
    return Response.json({ mode: 'quota', plan, usage });
  }

  // ── Mode 2: circuit state inspect ───────────────────────
  if (searchParams.get('circuit_state') === '1') {
    const states = await Promise.all(
      [
        'llm:anthropic:claude-sonnet-4-6',
        'llm:anthropic:claude-haiku-4-5',
        'llm:openrouter:openai/gpt-oss-20b:free',
      ].map(async (name) => ({ name, ...(await getCircuitState(name)) })),
    );
    return Response.json({ mode: 'circuit_state', circuits: states });
  }

  // ── Mode 3: happy path call (default) ───────────────────
  const start = Date.now();
  try {
    const result = await routedGenerateText({
      useCase: 'classify',
      userId,
      plan,
      system: 'Bạn là trợ lý. Trả về CHỈ 1 từ tiếng Việt.',
      messages: [
        { role: 'user', content: 'Một con số từ 1 đến 10. Chỉ 1 từ.' },
      ],
      maxOutputTokens: 20,
      feature: 'debug-test',
      timeoutMs: 15_000,
    });

    return Response.json({
      mode: 'ok',
      latencyMs: Date.now() - start,
      provider: result.providerId,
      model: result.modelId,
      text: result.text,
      tokens: {
        prompt: result.promptTokens,
        completion: result.completionTokens,
      },
      costUsd: result.costUsd,
    });
  } catch (err) {
    if (err instanceof CostGuardrailError) {
      return Response.json(
        {
          mode: 'cost_blocked',
          reason: err.reason,
          message: err.message,
          latencyMs: Date.now() - start,
        },
        { status: 429 },
      );
    }
    if (err instanceof AllProvidersFailedError) {
      return Response.json(
        {
          mode: 'all_failed',
          message: err.message,
          lastError: err.lastError?.message,
          latencyMs: Date.now() - start,
        },
        { status: 503 },
      );
    }
    return Response.json(
      {
        mode: 'error',
        message: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - start,
      },
      { status: 500 },
    );
  }
}
