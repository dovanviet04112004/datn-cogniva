/**
 * LLM Router — multi-provider fallback chain với circuit breaker + cost guardrail.
 *
 * Plan v2 §8.1 + §0.3 risks A1, A2 mitigation.
 *
 * Trách nhiệm:
 *   1. Route theo use case (RAG chat / reasoning / classify / etc.)
 *   2. Per-provider circuit breaker (Anthropic down → tự fallback)
 *   3. Cost guardrail (per-request cap + daily quota + global circuit)
 *   4. Record actual cost sau khi LLM call xong
 *   5. Log + trace (Langfuse + Sentry)
 *
 * Pattern dùng (replace `getChatModel()` cũ):
 *
 *   const { textStream, finishPromise } = await routedStreamText({
 *     useCase: 'ragChat',
 *     userId: session.user.id,
 *     plan: session.user.plan,
 *     system: 'You are...',
 *     messages: [...],
 *     maxOutputTokens: 1000,
 *     feature: 'chat-main',
 *   });
 *
 * Khác biệt với raw streamText():
 *   - Pre-check cost guardrail (deny trước khi call provider)
 *   - Mỗi provider call wrap trong withCircuitBreaker
 *   - Auto fallback chain theo route config
 *   - Auto record cost sau onFinish
 *
 * Backward compat:
 *   - getChatModel() cũ vẫn export (chưa migrate hết route)
 *   - Migrate routes từ từ qua các phase tiếp.
 */
import { streamText, generateText, type LanguageModel, type CoreMessage } from 'ai';
type StreamTextResult = ReturnType<typeof streamText>;
import { anthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGroq } from '@ai-sdk/groq';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

import {
  checkCostGuardrail,
  recordCost,
  estimateCostUsd,
  type Plan,
} from '../observability/cost-guardrail';
import { logger } from '../observability/logger';
import { calcCostUsd } from '../observability/cost';

import { withCircuitBreaker, CircuitOpenError } from './circuit-breaker';
import {
  buildCachedMessages,
  shouldEnableCache,
  extractCacheStats,
} from './prompt-cache';
import {
  getCachedResponse,
  setCachedResponse,
  streamCachedText,
  recordCacheStat,
  type CacheScope,
} from './semantic-cache';

// ────────────────────────────────────────────────────────────
// Provider configs
// ────────────────────────────────────────────────────────────

type ProviderId = 'anthropic' | 'openrouter' | 'openai' | 'groq' | 'google';
type ModelId = string;

type ProviderModel = {
  provider: ProviderId;
  model: ModelId;
  /** USD per 1M input tokens. */
  inputPerM: number;
  /** USD per 1M output tokens. */
  outputPerM: number;
  /** Available env check — provider chỉ usable nếu env có. */
  isAvailable: () => boolean;
};

const PROVIDERS: Record<string, ProviderModel> = {
  'anthropic:sonnet-4-6': {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    inputPerM: 3,
    outputPerM: 15,
    isAvailable: () => !!process.env.ANTHROPIC_API_KEY,
  },
  'anthropic:haiku-4-5': {
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    inputPerM: 0.8,
    outputPerM: 4,
    isAvailable: () => !!process.env.ANTHROPIC_API_KEY,
  },
  'anthropic:opus-4-7': {
    provider: 'anthropic',
    model: 'claude-opus-4-7',
    inputPerM: 15,
    outputPerM: 75,
    isAvailable: () => !!process.env.ANTHROPIC_API_KEY,
  },
  'openrouter:gpt-oss-20b': {
    provider: 'openrouter',
    model: 'openai/gpt-oss-20b:free',
    inputPerM: 0,
    outputPerM: 0,
    isAvailable: () => !!process.env.OPENROUTER_API_KEY,
  },
  'openrouter:glm-4.5-air': {
    provider: 'openrouter',
    model: 'z-ai/glm-4.5-air:free',
    inputPerM: 0,
    outputPerM: 0,
    isAvailable: () => !!process.env.OPENROUTER_API_KEY,
  },
  // ── Groq (free 30 req/min, ~800 tok/s tốc độ cao nhất hiện tại) ──
  // Pricing chỉ cho production paid tier — free tier inputPerM=0
  'groq:llama-3.3-70b': {
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    inputPerM: 0,
    outputPerM: 0,
    isAvailable: () => !!process.env.GROQ_API_KEY,
  },
  'groq:llama-3.1-8b': {
    provider: 'groq',
    model: 'llama-3.1-8b-instant',
    inputPerM: 0,
    outputPerM: 0,
    isAvailable: () => !!process.env.GROQ_API_KEY,
  },
  // ── Gemini (free 15 req/min, 1M token/day) ──
  // Gemini 2.5 Flash — latest 2026-05, multimodal + 1M context, default cho gen
  'google:gemini-2.5-flash': {
    provider: 'google',
    model: 'gemini-2.5-flash',
    inputPerM: 0,
    outputPerM: 0,
    isAvailable: () => !!process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  },
  // 2.0 Flash Lite — siêu nhanh + rẻ hơn, dùng cho classify/noteComplete
  'google:gemini-2.0-flash-lite': {
    provider: 'google',
    model: 'gemini-2.0-flash-lite',
    inputPerM: 0,
    outputPerM: 0,
    isAvailable: () => !!process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  },
};

// ────────────────────────────────────────────────────────────
// Use case → route mapping
// ────────────────────────────────────────────────────────────

export type UseCase =
  | 'ragChat' // user-facing RAG chat
  | 'reasoning' // hard math / multi-step
  | 'classify' // chunking metadata, intent classify
  | 'roomTutor' // in-room AI streaming
  | 'flashcardGen' // generate flashcards
  | 'quizGen' // generate quiz
  | 'noteComplete' // autocomplete in note editor
  | 'summarize'; // recording summary

type Route = {
  primary: keyof typeof PROVIDERS;
  fallback: Array<keyof typeof PROVIDERS>;
  /** Max output tokens cho route — guard against runaway. */
  maxOutputTokens: number;
};

/**
 * Fallback chain strategy (cập nhật 2026-05 — thêm Groq + Gemini free):
 *   Production path: Anthropic primary → Anthropic cheaper fallback → free tier
 *   Dev path: chỉ cần 1 free key bất kỳ (OpenRouter/Groq/Gemini) là chạy được
 *
 * Thứ tự fallback free:
 *   1. Groq (nhanh nhất 800 tok/s, 30 req/min free) — first fallback cho task cần latency
 *   2. Gemini Flash (1M ctx, 15 req/min free) — fallback cho task cần long context
 *   3. OpenRouter gpt-oss-20b (50 req/day free) — last resort, hay 429
 */
const ROUTES: Record<UseCase, Route> = {
  ragChat: {
    primary: 'anthropic:sonnet-4-6',
    fallback: ['groq:llama-3.3-70b', 'google:gemini-2.5-flash', 'openrouter:gpt-oss-20b'],
    maxOutputTokens: 1500,
  },
  reasoning: {
    primary: 'anthropic:opus-4-7',
    fallback: ['anthropic:sonnet-4-6', 'groq:llama-3.3-70b', 'google:gemini-2.5-flash'],
    maxOutputTokens: 4000,
  },
  classify: {
    primary: 'anthropic:haiku-4-5',
    fallback: ['groq:llama-3.1-8b', 'google:gemini-2.0-flash-lite', 'openrouter:gpt-oss-20b'],
    maxOutputTokens: 500,
  },
  roomTutor: {
    primary: 'anthropic:sonnet-4-6',
    fallback: ['anthropic:haiku-4-5', 'groq:llama-3.3-70b', 'openrouter:gpt-oss-20b'],
    maxOutputTokens: 800,
  },
  flashcardGen: {
    primary: 'anthropic:sonnet-4-6',
    fallback: ['anthropic:haiku-4-5', 'groq:llama-3.3-70b', 'google:gemini-2.5-flash'],
    maxOutputTokens: 2000,
  },
  quizGen: {
    primary: 'anthropic:sonnet-4-6',
    fallback: ['anthropic:haiku-4-5', 'groq:llama-3.3-70b', 'google:gemini-2.5-flash'],
    maxOutputTokens: 3000,
  },
  noteComplete: {
    // Latency-sensitive — Groq nhanh nhất phù hợp
    primary: 'anthropic:haiku-4-5',
    fallback: ['groq:llama-3.1-8b', 'google:gemini-2.0-flash-lite', 'openrouter:gpt-oss-20b'],
    maxOutputTokens: 300,
  },
  summarize: {
    primary: 'anthropic:sonnet-4-6',
    fallback: ['anthropic:haiku-4-5', 'groq:llama-3.3-70b', 'google:gemini-2.5-flash'],
    maxOutputTokens: 1000,
  },
};

// ────────────────────────────────────────────────────────────
// Client construction
// ────────────────────────────────────────────────────────────

let _openrouter: ReturnType<typeof createOpenAI> | undefined;
function getOpenRouterFactory() {
  if (_openrouter) return _openrouter;
  _openrouter = createOpenAI({
    apiKey: process.env.OPENROUTER_API_KEY!,
    baseURL: 'https://openrouter.ai/api/v1',
    headers: {
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
      'X-Title': 'Cogniva',
    },
    compatibility: 'compatible',
  });
  return _openrouter;
}

let _groq: ReturnType<typeof createGroq> | undefined;
function getGroqFactory() {
  if (_groq) return _groq;
  _groq = createGroq({ apiKey: process.env.GROQ_API_KEY! });
  return _groq;
}

let _google: ReturnType<typeof createGoogleGenerativeAI> | undefined;
function getGoogleFactory() {
  if (_google) return _google;
  _google = createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY!,
  });
  return _google;
}

/**
 * Resolve LanguageModel cho provider:model. Throw nếu provider thiếu env.
 */
function getModel(pm: ProviderModel): LanguageModel {
  switch (pm.provider) {
    case 'anthropic':
      return anthropic(pm.model);
    case 'openrouter':
      return getOpenRouterFactory()(pm.model);
    case 'groq':
      return getGroqFactory()(pm.model);
    case 'google':
      return getGoogleFactory()(pm.model);
    case 'openai':
      // Future: native OpenAI provider khi cần GPT
      throw new Error('OpenAI direct provider chưa implement');
    default:
      throw new Error(`Unknown provider: ${pm.provider}`);
  }
}

/**
 * Lấy chain provider khả dụng cho use case (primary + fallbacks).
 * Filter ra những provider thiếu env.
 */
function getProviderChain(useCase: UseCase): ProviderModel[] {
  const route = ROUTES[useCase];
  const chain = [route.primary, ...route.fallback];
  return chain
    .map((id) => PROVIDERS[id]!)
    .filter((p) => p.isAvailable());
}

// ────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────

export type RoutedStreamOptions = {
  useCase: UseCase;
  userId: string;
  plan: Plan;
  /** Estimate input tokens — caller có thể đếm trước hoặc dùng heuristic. */
  estimatedInputTokens?: number;
  system?: string;
  messages: CoreMessage[];
  /** Override maxOutputTokens từ route default. */
  maxOutputTokens?: number;
  /** Feature tag cho cost breakdown analytics. */
  feature?: string;
  /** Per-message timeout (ms). Default 60s. */
  timeoutMs?: number;
  /**
   * Anthropic prompt caching — default true cho Anthropic provider.
   * Set false để force uncached (debug, A/B test, hoặc dynamic system prompt
   * mỗi request — cache sẽ never hit).
   */
  enablePromptCache?: boolean;
  /**
   * Semantic cache (Redis exact-hash). Default false — caller opt-in.
   * Bật cho stateless query (classify, simple Q&A, translation).
   * KHÔNG bật cho conversational (mỗi msg depend prev).
   */
  enableSemanticCache?: boolean;
  /**
   * Scope cache: 'user' (default, safe) hoặc 'shared' (cho factual content
   * không user-specific — flashcardGen, generic classify).
   */
  cacheScope?: CacheScope;
  /**
   * TTL cache (sec). Default 300 (5 phút). Override cho longer-stable content.
   */
  cacheTtlSec?: number;
};

export type RoutedStreamResult = {
  textStream: AsyncIterable<string>;
  /** Resolve khi stream xong. Trả meta info. */
  finishPromise: Promise<{
    text: string;
    promptTokens: number;
    completionTokens: number;
    modelId: string;
    providerId: ProviderId;
    costUsd: number;
    /** True nếu Anthropic prompt cache hit (Stage 1 W6). */
    cacheHit: boolean;
    /** Number of cached tokens read (for analytics). */
    cacheReadTokens: number;
  }>;
  /** Provider thực sự được dùng (sau fallback). */
  providerUsed: ProviderId;
  modelUsed: ModelId;
  /**
   * Raw streamText result để caller có thể dùng:
   *   - `result.toDataStreamResponse()` cho HTTP SSE response
   *   - `result.mergeIntoDataStream(stream)` cho custom annotation flow
   *   - `result.toTextStreamResponse()` cho plain text streaming
   * Chỉ dùng khi cần advanced AI SDK features; happy path dùng textStream.
   */
  result: StreamTextResult;
};

/**
 * Stream LLM response với fallback chain + guardrail tự động.
 *
 * Flow:
 *   1. Get provider chain (filter unavailable).
 *   2. Estimate cost với primary provider.
 *   3. Check cost guardrail — deny nếu fail.
 *   4. Try primary qua circuit breaker.
 *      Fail → try next fallback. Hết → throw.
 *   5. Stream textStream.
 *   6. finishPromise: record cost actual + log.
 */
export async function routedStreamText(
  opts: RoutedStreamOptions,
): Promise<RoutedStreamResult> {
  const chain = getProviderChain(opts.useCase);
  if (chain.length === 0) {
    throw new Error(
      `[ai-router] Không có provider khả dụng cho use case "${opts.useCase}". ` +
        'Set ANTHROPIC_API_KEY hoặc OPENROUTER_API_KEY trong .env.local.',
    );
  }

  const route = ROUTES[opts.useCase];
  const maxOut = opts.maxOutputTokens ?? route.maxOutputTokens;

  // Estimate cost với primary (worst case nếu fallback rẻ hơn)
  const primary = chain[0]!;
  const estimatedInput = opts.estimatedInputTokens ?? estimateInputTokens(opts);
  const estimatedCost = estimateCostUsd({
    inputTokens: estimatedInput,
    maxOutputTokens: maxOut,
    inputPerMUsd: primary.inputPerM,
    outputPerMUsd: primary.outputPerM,
  });

  // ── Semantic cache lookup (TRƯỚC guardrail vì hit = free) ─────────
  // Chỉ lookup nếu caller opt-in (default false).
  // Lấy query từ message cuối user — đó là semantic key chính.
  if (opts.enableSemanticCache && opts.system) {
    const lastUserMsg = [...opts.messages].reverse().find((m) => m.role === 'user');
    const queryText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
    if (queryText) {
      const cached = await getCachedResponse({
        useCase: opts.useCase,
        query: queryText,
        systemPrompt: opts.system,
        scope: opts.cacheScope ?? 'user',
        userId: opts.userId,
      });
      await recordCacheStat(opts.useCase, !!cached);
      if (cached) {
        // Hit — stream cached text mimic streamText behavior.
        // KHÔNG record cost (user không trả tiền lần này).
        return buildCachedResult(cached);
      }
    }
  }

  // Cost guardrail — deny nếu vượt
  const guard = await checkCostGuardrail({
    userId: opts.userId,
    plan: opts.plan,
    estimatedCostUsd: estimatedCost,
  });
  if (!guard.allowed) {
    logger.warn('ai-router.denied', {
      reason: guard.reason,
      user_id: opts.userId,
      use_case: opts.useCase,
      estimated_cost_usd: estimatedCost,
    });
    throw new CostGuardrailError(guard.message, guard.reason);
  }

  // Try chain — primary trước, fallback nếu circuit OPEN hoặc lỗi
  let lastError: Error | undefined;
  for (const pm of chain) {
    const circuitName = `llm:${pm.provider}:${pm.model}`;
    try {
      return await withCircuitBreaker(circuitName, async () => {
        const model = getModel(pm);
        return executeStream({
          model,
          providerModel: pm,
          opts,
          maxOut,
        });
      });
    } catch (err) {
      lastError = err as Error;
      if (err instanceof CircuitOpenError) {
        logger.warn('ai-router.circuit_open_skip', {
          circuit: circuitName,
          use_case: opts.useCase,
        });
        continue; // try next fallback
      }
      // Lỗi khác (rate limit provider, network, etc.) → cũng fallback
      logger.warn('ai-router.provider_failed', {
        circuit: circuitName,
        use_case: opts.useCase,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
  }

  // Tất cả fallback fail
  throw new AllProvidersFailedError(
    `Tất cả ${chain.length} provider thất bại cho ${opts.useCase}`,
    lastError,
  );
}

/**
 * Build RoutedStreamResult từ cached response — mimic streamText interface.
 *
 * Caller dùng giống result LLM thật:
 *   for await (const delta of result.textStream) { ... }
 *   const { text, costUsd } = await result.finishPromise;
 *
 * Khác biệt:
 *   - costUsd = 0 (free, đã trả lần đầu khi cache)
 *   - cacheHit = true
 *   - result (raw streamText) là stub minimal — KHÔNG dùng được
 *     mergeIntoDataStream. Caller phải kiểm cacheHit để xử lý khác.
 */
function buildCachedResult(
  cached: import('./semantic-cache').CachedResponse,
): RoutedStreamResult {
  const stream = streamCachedText(cached.text);
  const finish = Promise.resolve({
    text: cached.text,
    promptTokens: cached.promptTokens,
    completionTokens: cached.completionTokens,
    modelId: cached.modelId,
    providerId: cached.providerId as ProviderId,
    costUsd: 0, // cache hit = free
    cacheHit: true, // wire semantic hit qua field này (reuse Anthropic field)
    cacheReadTokens: cached.promptTokens,
  });
  return {
    textStream: stream,
    finishPromise: finish,
    providerUsed: cached.providerId as ProviderId,
    modelUsed: cached.modelId,
    // Stub result — caller phải check cacheHit trước khi dùng mergeIntoDataStream
    result: {
      textStream: stream,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  };
}

/**
 * Helper: thực sự stream từ 1 provider.
 */
function executeStream(args: {
  model: LanguageModel;
  providerModel: ProviderModel;
  opts: RoutedStreamOptions;
  maxOut: number;
}): RoutedStreamResult {
  const { model, providerModel, opts, maxOut } = args;

  // Decide prompt caching — default ON cho Anthropic + system đủ dài.
  const enableCache =
    (opts.enablePromptCache ?? true) &&
    !!opts.system &&
    shouldEnableCache(providerModel.provider, opts.system.length);

  // Build messages: cached pattern (system in array với cacheControl) hoặc raw.
  let finalMessages: CoreMessage[];
  let finalSystem: string | undefined;
  if (enableCache && opts.system) {
    const cached = buildCachedMessages(opts.system, opts.messages);
    if (cached) {
      finalMessages = cached;
      finalSystem = undefined; // system trong messages array rồi
    } else {
      // Fallback uncached nếu builder reject (vd system < 1024 token)
      finalMessages = opts.messages;
      finalSystem = opts.system;
    }
  } else {
    finalMessages = opts.messages;
    finalSystem = opts.system;
  }

  // Promise resolve khi onFinish callback fire
  let resolveFinish!: (v: RoutedStreamResult['finishPromise'] extends Promise<infer R> ? R : never) => void;
  let rejectFinish!: (e: unknown) => void;
  const finishPromise = new Promise<{
    text: string;
    promptTokens: number;
    completionTokens: number;
    modelId: string;
    providerId: ProviderId;
    costUsd: number;
    cacheHit: boolean;
    cacheReadTokens: number;
  }>((resolve, reject) => {
    resolveFinish = resolve;
    rejectFinish = reject;
  });

  const result = streamText({
    model,
    system: finalSystem,
    messages: finalMessages,
    maxTokens: maxOut,
    abortSignal: opts.timeoutMs
      ? AbortSignal.timeout(opts.timeoutMs)
      : undefined,
    onFinish: async ({ text, usage, providerMetadata }) => {
      // Parse cache stats — chỉ Anthropic populate
      const cacheStats = extractCacheStats(providerMetadata);

      const costUsd = calcCostUsd(
        providerModel.model,
        usage.promptTokens,
        usage.completionTokens,
      );

      // Record actual cost — không block stream. Phase 3 thêm provider + token
      // details để ai_usage_log có data đầy đủ cho admin dashboard.
      await recordCost({
        userId: opts.userId,
        plan: opts.plan,
        costUsd,
        model: providerModel.model,
        feature: opts.feature ?? opts.useCase,
        provider: providerModel.provider,
        tokensIn: usage.promptTokens,
        tokensOut: usage.completionTokens,
      });

      // Save vào semantic cache nếu enabled (best-effort, không await dài)
      if (opts.enableSemanticCache && opts.system) {
        const lastUserMsg = [...opts.messages].reverse().find((m) => m.role === 'user');
        const queryText =
          typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
        if (queryText && text) {
          void setCachedResponse({
            useCase: opts.useCase,
            query: queryText,
            systemPrompt: opts.system,
            scope: opts.cacheScope ?? 'user',
            userId: opts.userId,
            ttlSec: opts.cacheTtlSec,
            response: {
              text,
              modelId: providerModel.model,
              providerId: providerModel.provider,
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              originalCostUsd: costUsd,
              cachedAt: new Date().toISOString(),
            },
          });
        }
      }

      logger.info('ai-router.completed', {
        use_case: opts.useCase,
        provider: providerModel.provider,
        model: providerModel.model,
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
        cost_usd: costUsd,
        user_id: opts.userId,
        feature: opts.feature,
        cache_hit: cacheStats.cacheHit,
        cache_read_tokens: cacheStats.cacheReadTokens,
        cache_creation_tokens: cacheStats.cacheCreationTokens,
      });

      resolveFinish({
        text,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        modelId: providerModel.model,
        providerId: providerModel.provider,
        costUsd,
        cacheHit: cacheStats.cacheHit,
        cacheReadTokens: cacheStats.cacheReadTokens,
      });
    },
    onError: ({ error }) => {
      logger.error('ai-router.stream_error', {
        use_case: opts.useCase,
        provider: providerModel.provider,
        error: error instanceof Error ? error.message : String(error),
      });
      rejectFinish(error);
    },
  });

  return {
    textStream: result.textStream,
    finishPromise,
    providerUsed: providerModel.provider,
    modelUsed: providerModel.model,
    result,
  };
}

/**
 * Non-streaming variant — cho task batch (classify, summarize chunk).
 */
export async function routedGenerateText(
  opts: Omit<RoutedStreamOptions, 'timeoutMs'> & { timeoutMs?: number },
): Promise<{
  text: string;
  promptTokens: number;
  completionTokens: number;
  modelId: string;
  providerId: ProviderId;
  costUsd: number;
}> {
  const chain = getProviderChain(opts.useCase);
  if (chain.length === 0) {
    throw new Error(`[ai-router] Không có provider cho ${opts.useCase}`);
  }
  const route = ROUTES[opts.useCase];
  const maxOut = opts.maxOutputTokens ?? route.maxOutputTokens;

  const primary = chain[0]!;
  const estimatedInput = opts.estimatedInputTokens ?? estimateInputTokens(opts);
  const estimatedCost = estimateCostUsd({
    inputTokens: estimatedInput,
    maxOutputTokens: maxOut,
    inputPerMUsd: primary.inputPerM,
    outputPerMUsd: primary.outputPerM,
  });

  // ── Semantic cache lookup (TRƯỚC guardrail vì hit = free) ─────────
  // Khác routedStreamText: result trả full text 1 lần (không stream chunk)
  if (opts.enableSemanticCache && opts.system) {
    const lastUserMsg = [...opts.messages].reverse().find((m) => m.role === 'user');
    const queryText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
    if (queryText) {
      const cached = await getCachedResponse({
        useCase: opts.useCase,
        query: queryText,
        systemPrompt: opts.system,
        scope: opts.cacheScope ?? 'user',
        userId: opts.userId,
      });
      await recordCacheStat(opts.useCase, !!cached);
      if (cached) {
        return {
          text: cached.text,
          promptTokens: cached.promptTokens,
          completionTokens: cached.completionTokens,
          modelId: cached.modelId,
          providerId: cached.providerId as ProviderId,
          costUsd: 0, // cache hit = free
        };
      }
    }
  }

  const guard = await checkCostGuardrail({
    userId: opts.userId,
    plan: opts.plan,
    estimatedCostUsd: estimatedCost,
  });
  if (!guard.allowed) {
    throw new CostGuardrailError(guard.message, guard.reason);
  }

  let lastError: Error | undefined;
  for (const pm of chain) {
    const circuitName = `llm:${pm.provider}:${pm.model}`;
    try {
      return await withCircuitBreaker(circuitName, async () => {
        const model = getModel(pm);
        const result = await generateText({
          model,
          system: opts.system,
          messages: opts.messages,
          maxTokens: maxOut,
          abortSignal: opts.timeoutMs
            ? AbortSignal.timeout(opts.timeoutMs)
            : undefined,
        });

        const costUsd = calcCostUsd(
          pm.model,
          result.usage.promptTokens,
          result.usage.completionTokens,
        );
        await recordCost({
          userId: opts.userId,
          plan: opts.plan,
          costUsd,
          model: pm.model,
          feature: opts.feature ?? opts.useCase,
          provider: pm.provider,
          tokensIn: result.usage.promptTokens,
          tokensOut: result.usage.completionTokens,
        });
        logger.info('ai-router.completed', {
          use_case: opts.useCase,
          provider: pm.provider,
          model: pm.model,
          prompt_tokens: result.usage.promptTokens,
          completion_tokens: result.usage.completionTokens,
          cost_usd: costUsd,
          user_id: opts.userId,
        });

        // Save vào cache nếu opt-in. Best-effort, không block return.
        if (opts.enableSemanticCache && opts.system) {
          const lastUserMsg = [...opts.messages].reverse().find((m) => m.role === 'user');
          const queryText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
          if (queryText) {
            void setCachedResponse({
              useCase: opts.useCase,
              query: queryText,
              systemPrompt: opts.system,
              scope: opts.cacheScope ?? 'user',
              userId: opts.userId,
              response: {
                text: result.text,
                modelId: pm.model,
                providerId: pm.provider,
                promptTokens: result.usage.promptTokens,
                completionTokens: result.usage.completionTokens,
                originalCostUsd: costUsd,
                cachedAt: new Date().toISOString(),
              },
              ttlSec: opts.cacheTtlSec,
            });
          }
        }

        return {
          text: result.text,
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          modelId: pm.model,
          providerId: pm.provider,
          costUsd,
        };
      });
    } catch (err) {
      lastError = err as Error;
      if (err instanceof CircuitOpenError) continue;
      logger.warn('ai-router.provider_failed', {
        circuit: circuitName,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
  }

  throw new AllProvidersFailedError(
    `Tất cả ${chain.length} provider thất bại`,
    lastError,
  );
}

/**
 * Rough heuristic: 1 token ≈ 4 ký tự cho English, 2-3 cho VN.
 * Dùng 3 ký tự/token làm safe default. Không cần chính xác — chỉ để estimate cost.
 */
function estimateInputTokens(opts: RoutedStreamOptions): number {
  const systemLen = opts.system?.length ?? 0;
  const messagesLen = opts.messages.reduce((sum, m) => {
    if (typeof m.content === 'string') return sum + m.content.length;
    return sum + 100; // multimodal, estimate
  }, 0);
  return Math.ceil((systemLen + messagesLen) / 3);
}

// ────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────

export class CostGuardrailError extends Error {
  override name = 'CostGuardrailError';
  constructor(
    message: string,
    public reason: 'PER_REQUEST_CAP' | 'DAILY_QUOTA' | 'GLOBAL_CIRCUIT' | 'COPPA_PENDING',
  ) {
    super(message);
  }
}

export class AllProvidersFailedError extends Error {
  override name = 'AllProvidersFailedError';
  constructor(
    message: string,
    public lastError?: Error,
  ) {
    super(message);
  }
}
