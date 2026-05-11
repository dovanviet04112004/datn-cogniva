/**
 * Cost tracking — tính tiền USD cho mỗi LLM call dựa trên token usage.
 *
 * Pricing (Jan 2026, có thể stale):
 *   - claude-sonnet-4-6: $3 / 1M input, $15 / 1M output
 *   - claude-haiku-4-5: $0.25 / 1M in, $1.25 / 1M out (estimate)
 *   - claude-opus-4-7: $15 / 1M in, $75 / 1M out
 *   - voyage-3 embed: $0.18 / 1M token
 *
 * Trả về cost USD (number, ≥ 0). Caller lưu vào message.metadata.costUsd
 * hoặc aggregate qua /api/analytics.
 */

type Pricing = {
  inputPerM: number; // USD / 1M input tokens
  outputPerM: number;
};

const MODEL_PRICING: Record<string, Pricing> = {
  'claude-sonnet-4-6': { inputPerM: 3, outputPerM: 15 },
  'claude-sonnet-4-5': { inputPerM: 3, outputPerM: 15 },
  'claude-haiku-4-5': { inputPerM: 0.25, outputPerM: 1.25 },
  'claude-opus-4-7': { inputPerM: 15, outputPerM: 75 },
  'gemini-2.0-flash': { inputPerM: 0.075, outputPerM: 0.3 },
  // Voyage embedding tính riêng (output=0, chỉ input matter)
  'voyage-3': { inputPerM: 0.18, outputPerM: 0 },
  'voyage-3-large': { inputPerM: 0.18, outputPerM: 0 },
};

/**
 * Tính cost USD từ model ID + token counts.
 * Trả 0 nếu không có pricing cho model (unknown → ưu tiên không charge thừa).
 */
export function calcCostUsd(
  modelId: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const pricing = MODEL_PRICING[modelId];
  if (!pricing) return 0;
  const cost =
    (promptTokens * pricing.inputPerM + completionTokens * pricing.outputPerM) /
    1_000_000;
  return Number(cost.toFixed(6)); // 6 chữ số sau dấu phẩy = $0.000001 precision
}
