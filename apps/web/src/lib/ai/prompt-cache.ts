/**
 * Anthropic prompt caching helper.
 *
 * Plan v2 §15.1 W6 cost optimization: Anthropic prompt caching giảm cost
 * 90% trên cached portion + giảm latency 50% TTFT.
 *
 * Cách Anthropic cache hoạt động (2026):
 *   - Min cache: 1024 tokens (Sonnet) hoặc 2048 (Opus)
 *   - Max 4 cache blocks per request
 *   - TTL ephemeral: 5 phút default, 1h với premium pricing
 *   - Cache write cost: 1.25x normal (one-time)
 *   - Cache read cost: 0.1x normal (huge save)
 *   - Hit rate điển hình 60-90% cho chat continuity
 *
 * Cogniva use case:
 *   - System prompt (persona + RAG instructions) — same per user session
 *   - Retrieved chunks (top-K) — relatively stable across follow-up queries
 *   - Conversation history (last 10 messages) — append-only growth
 *
 * Pattern:
 *   - Mark system + first chunks-rich user message với cacheControl
 *   - Subsequent identical prefix → cache hit
 *   - Khi user gửi new follow-up, prefix same → free reuse system + first message
 *
 * Cost economics example:
 *   - Cogniva system prompt ~2000 tokens, $3/M input = $0.006
 *   - 10 follow-up queries same conv:
 *     - Without cache: 10 × $0.006 = $0.060
 *     - With cache: write $0.0075 (1x) + 9 reads × $0.0006 = $0.0129
 *     - Save ~78%
 *
 * Limit:
 *   - KHÔNG cache cho non-Anthropic provider (router fallback OpenRouter
 *     vẫn work nhưng skip cache logic).
 *   - System ngắn < 1024 token → cache không hoạt động (Anthropic reject).
 *     Auto-fallback uncached.
 */
import type { CoreMessage } from 'ai';

/** Min char để cân nhắc cache (~1024 token với 3 char/token VN). */
const MIN_CACHE_CHARS = 3_500;

/**
 * Estimate token từ string. Heuristic VN: 1 token ~ 3 char.
 * Không cần chính xác — chỉ để decide cache hay không.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/**
 * Build messages với cache control cho Anthropic.
 *
 * Strategy:
 *   1. System prompt → message role=system với cacheControl (nếu ≥ 1024 token)
 *   2. Append message history (user/assistant) sau system
 *   3. Caller giữ ratio cache hit cao bằng cách giữ system stable across calls
 *
 * @param system - System prompt string
 * @param messages - Conversation history (user + assistant)
 * @returns Messages array đã wire cacheControl, hoặc null nếu không cache được
 *          (system quá ngắn) — caller fallback dùng `system: string` pattern.
 */
export function buildCachedMessages(
  system: string,
  messages: CoreMessage[],
): CoreMessage[] | null {
  // Min length check — Anthropic reject cache < 1024 token
  if (estimateTokens(system) < 1024) {
    return null;
  }

  // System message với cacheControl trên content text part
  const systemMessage: CoreMessage = {
    role: 'system',
    content: system,
    // providerOptions ở message level — Anthropic provider hiểu
    providerOptions: {
      anthropic: {
        cacheControl: { type: 'ephemeral' },
      },
    },
  };

  return [systemMessage, ...messages];
}

/**
 * Quyết định có nên cache không cho 1 request.
 *
 * @param provider - Provider id ('anthropic' mới support).
 * @param systemLength - Char length của system prompt.
 * @returns True nếu cache enabled.
 */
export function shouldEnableCache(provider: string, systemLength: number): boolean {
  if (provider !== 'anthropic') return false;
  if (systemLength < MIN_CACHE_CHARS) return false;
  return true;
}

/**
 * Parse cache hit info từ usage response Anthropic.
 *
 * Anthropic usage có 2 field bonus:
 *   - cache_creation_input_tokens : write cache (1.25x cost)
 *   - cache_read_input_tokens     : read cache (0.1x cost)
 *
 * AI SDK expose qua providerMetadata.anthropic.cacheCreationInputTokens etc.
 */
export type CacheStats = {
  cacheCreationTokens: number;
  cacheReadTokens: number;
  /** True nếu có cache read (= cache hit ở previous request). */
  cacheHit: boolean;
};

export function extractCacheStats(providerMetadata: unknown): CacheStats {
  const anthropic = (providerMetadata as Record<string, unknown> | undefined)?.anthropic as
    | { cacheCreationInputTokens?: number; cacheReadInputTokens?: number }
    | undefined;
  const cacheCreation = anthropic?.cacheCreationInputTokens ?? 0;
  const cacheRead = anthropic?.cacheReadInputTokens ?? 0;
  return {
    cacheCreationTokens: cacheCreation,
    cacheReadTokens: cacheRead,
    cacheHit: cacheRead > 0,
  };
}

/**
 * Calculate adjusted cost cho Anthropic với prompt cache.
 *
 * Pricing per 1M tokens (Sonnet 4.6):
 *   - Standard input: $3
 *   - Cache write:    $3.75 (1.25x)
 *   - Cache read:     $0.30 (0.1x)
 *   - Output:         $15
 *
 * @returns USD cost.
 */
export function calcAnthropicCacheCost(args: {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  inputPerM: number;
  outputPerM: number;
}): number {
  // Standard input = inputTokens - cache creation - cache read
  const standardInput = Math.max(
    0,
    args.inputTokens - args.cacheCreationTokens - args.cacheReadTokens,
  );
  const cost =
    (standardInput * args.inputPerM +
      args.cacheCreationTokens * args.inputPerM * 1.25 +
      args.cacheReadTokens * args.inputPerM * 0.1 +
      args.outputTokens * args.outputPerM) /
    1_000_000;
  return Number(cost.toFixed(6));
}
