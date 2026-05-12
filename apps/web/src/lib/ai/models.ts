/**
 * Cấu hình LLM provider cho Cogniva.
 *
 * Pattern giống lib/ingest/embed.ts:
 *   - Anthropic primary (Claude Sonnet 4.6 — plan §3.3 default reasoner)
 *   - OpenRouter fallback (truy cập nhiều model qua OpenAI-compatible API,
 *     bao gồm các model FREE để test không cần thẻ tín dụng)
 *   - Throw khi cả 2 thiếu
 *
 * Vì sao Vercel AI SDK?
 *   - Streaming + useChat hook xử lý SSE phức tạp giúp ta
 *   - Provider neutral: switch model chỉ đổi 1 dòng
 *   - Tool calling chuẩn (Phase 4 dùng cho ReAct loop)
 *
 * Vì sao dùng @ai-sdk/openai cho OpenRouter (thay vì provider riêng)?
 *   - OpenRouter expose API OpenAI-compatible tại /api/v1
 *   - createOpenAI({ baseURL: 'https://openrouter.ai/api/v1' }) hoạt động
 *     ổn định + auto-update theo @ai-sdk/openai (không phụ thuộc provider
 *     wrapper bị stale)
 *
 * Free path qua OpenRouter (cập nhật 2026-05):
 *   openai/gpt-oss-20b:free       - OpenAI open-source 20B, ổn định nhất, default
 *   z-ai/glm-4.5-air:free         - GLM-4.5 Air (reasoning + tool tốt)
 *   openai/gpt-oss-120b:free      - lớn hơn, chậm hơn, dùng cho task khó
 *   qwen/qwen3-next-80b-a3b-instruct:free - context 262K, lý tưởng cho long doc
 *   meta-llama/llama-3.3-70b-instruct:free - hay rate-limit, tránh dùng default
 *
 * Tip: Free tier hay 429 (rate-limited) — set OPENROUTER_MODEL env để
 * override, hoặc kích hoạt OpenRouter "BYOK" trong settings để dùng key
 * gốc của provider (Llama via Cerebras, etc.) không rate-limited.
 */
import { anthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGroq } from '@ai-sdk/groq';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';

/** ID model mặc định khi user dùng Anthropic key — alias trỏ tới Sonnet 4.6 mới nhất. */
const ANTHROPIC_DEFAULT = 'claude-sonnet-4-6';

/** ID model OpenRouter free — gpt-oss-20b ổn định nhất 2026-05 (xem comment đầu file). */
const OPENROUTER_DEFAULT = 'openai/gpt-oss-20b:free';

/** Groq free — Llama 3.3 70B tốc độ ~800 tok/s. */
const GROQ_DEFAULT = 'llama-3.3-70b-versatile';

/** Gemini free — 2.5 Flash latest 2026, 1M context, 15 req/min free. */
const GOOGLE_DEFAULT = 'gemini-2.5-flash';

export type ChatProvider = 'anthropic' | 'openrouter' | 'groq' | 'google';

/**
 * Quyết định provider dựa trên env. Thứ tự ưu tiên:
 *   1. LLM_PROVIDER env var ép cứng (anthropic | openrouter | groq | google)
 *   2. ANTHROPIC_API_KEY → anthropic (production path, paid)
 *   3. GROQ_API_KEY → groq (free, fastest)
 *   4. GOOGLE_GENERATIVE_AI_API_KEY → google (free, 1M ctx)
 *   5. OPENROUTER_API_KEY → openrouter (free, hay 429)
 *   6. Throw lỗi rõ ràng
 *
 * Routing thông minh hơn xem `router.ts` — `routedStreamText/routedGenerateText`
 * có fallback chain + circuit breaker + cost guardrail. `getChatModel()` ở đây
 * legacy cho legacy code chưa migrate (room-tutor, summarize, flashcardGen).
 */
export function pickChatProvider(): ChatProvider {
  const forced = process.env.LLM_PROVIDER as ChatProvider | undefined;
  if (forced && ['anthropic', 'openrouter', 'groq', 'google'].includes(forced)) return forced;
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.GROQ_API_KEY) return 'groq';
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return 'google';
  if (process.env.OPENROUTER_API_KEY) return 'openrouter';
  throw new Error(
    '[ai] Không tìm thấy AI provider key. Setup ít nhất 1 cái:\n' +
      '  - ANTHROPIC_API_KEY (paid, production-grade) — console.anthropic.com\n' +
      '  - GROQ_API_KEY (free, ~800 tok/s) — console.groq.com\n' +
      '  - GOOGLE_GENERATIVE_AI_API_KEY (free, 1M ctx) — aistudio.google.com\n' +
      '  - OPENROUTER_API_KEY (free, multi-model) — openrouter.ai (không cần thẻ)\n',
  );
}

// Singleton OpenRouter client — createOpenAI tạo HTTP client + base URL config
let _openrouter: ReturnType<typeof createOpenAI> | undefined;
let _groq: ReturnType<typeof createGroq> | undefined;
let _google: ReturnType<typeof createGoogleGenerativeAI> | undefined;

/**
 * Tạo OpenAI-compatible client trỏ vào OpenRouter. Tận dụng tính ổn định
 * của @ai-sdk/openai mà không cần dedicated openrouter provider package.
 */
function getOpenRouterFactory() {
  if (_openrouter) return _openrouter;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('[ai] OPENROUTER_API_KEY missing');
  _openrouter = createOpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    // OpenRouter recommend 2 header để phân tích usage + leaderboard
    headers: {
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
      'X-Title': 'Cogniva',
    },
    // Bỏ check tracking compat — OpenRouter không trả OpenAI structured logprobs
    compatibility: 'compatible',
  });
  return _openrouter;
}

function getGroqFactory() {
  if (_groq) return _groq;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('[ai] GROQ_API_KEY missing');
  _groq = createGroq({ apiKey });
  return _groq;
}

function getGoogleFactory() {
  if (_google) return _google;
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) throw new Error('[ai] GOOGLE_GENERATIVE_AI_API_KEY missing');
  _google = createGoogleGenerativeAI({ apiKey });
  return _google;
}

/**
 * Trả về `LanguageModel` của Vercel AI SDK đã cấu hình sẵn provider.
 *
 * @param modelId - Override model id; fallback default theo provider
 * @returns LanguageModel sẵn dùng cho streamText / generateText
 */
export function getChatModel(modelId?: string): LanguageModel {
  const provider = pickChatProvider();
  switch (provider) {
    case 'anthropic':
      return anthropic(modelId ?? ANTHROPIC_DEFAULT);
    case 'groq':
      return getGroqFactory()(modelId ?? GROQ_DEFAULT);
    case 'google':
      return getGoogleFactory()(modelId ?? GOOGLE_DEFAULT);
    case 'openrouter':
      return getOpenRouterFactory()(modelId ?? OPENROUTER_DEFAULT);
  }
}

/** Model id đang dùng (cho metadata/log). */
export function getChatModelId(): string {
  const provider = pickChatProvider();
  switch (provider) {
    case 'anthropic':
      return process.env.ANTHROPIC_MODEL ?? ANTHROPIC_DEFAULT;
    case 'groq':
      return process.env.GROQ_MODEL ?? GROQ_DEFAULT;
    case 'google':
      return process.env.GOOGLE_MODEL ?? GOOGLE_DEFAULT;
    case 'openrouter':
      return process.env.OPENROUTER_MODEL ?? OPENROUTER_DEFAULT;
  }
}
