/**
 * Langfuse client wrapper — observability cho LLM + retrieval calls.
 *
 * Hành vi:
 *   - Nếu env LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY có → khởi Langfuse
 *     và trace mọi span (retrieval, generation, full chat).
 *   - Nếu không có → trả no-op object có cùng API surface (dùng được mà
 *     không cần if-check ở caller). Dev local không cần config gì.
 *
 * Phase 2 dùng để trace:
 *   - Mỗi turn chat: {input, retrieval chunks + scores, generation, output}
 *   - Cost + latency từng step
 *   - Model name, temperature, token usage
 *
 * Phase 3+ sẽ thêm eval scores (RAGAS faithfulness, answer relevancy)
 * và link tới golden dataset.
 */
import { Langfuse } from 'langfuse';

let _client: Langfuse | undefined;
let _initialized = false;

/**
 * Lấy Langfuse client singleton. Nếu chưa cấu hình env, trả undefined.
 */
function getClient(): Langfuse | undefined {
  if (_initialized) return _client;
  _initialized = true;

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) {
    // Không có env → tracing tắt ngầm. Dev local không cần warn.
    return undefined;
  }

  _client = new Langfuse({
    publicKey,
    secretKey,
    baseUrl: process.env.LANGFUSE_BASEURL ?? 'https://cloud.langfuse.com',
    flushAt: 1, // flush ngay sau mỗi event để dev thấy realtime
  });
  return _client;
}

/**
 * Tạo trace mới — đại diện 1 chuỗi operation (1 turn chat).
 *
 * Trả về object có các method `span` + `update` + `end`. Khi Langfuse tắt,
 * trả về no-op để caller không phải check.
 */
export function startTrace(input: {
  name: string;
  userId?: string;
  sessionId?: string;
  input?: unknown;
  metadata?: Record<string, unknown>;
}) {
  const client = getClient();
  if (!client) return noOpTrace();

  const trace = client.trace({
    name: input.name,
    userId: input.userId,
    sessionId: input.sessionId,
    input: input.input,
    metadata: input.metadata,
  });

  return {
    span: (spanInput: { name: string; input?: unknown; metadata?: Record<string, unknown> }) => {
      const span = trace.span({
        name: spanInput.name,
        input: spanInput.input,
        metadata: spanInput.metadata,
      });
      return {
        update: (data: { output?: unknown; metadata?: Record<string, unknown> }) =>
          span.update({ output: data.output, metadata: data.metadata }),
        end: () => span.end(),
      };
    },
    generation: (genInput: {
      name: string;
      model: string;
      input?: unknown;
      metadata?: Record<string, unknown>;
    }) => {
      const gen = trace.generation({
        name: genInput.name,
        model: genInput.model,
        input: genInput.input,
        metadata: genInput.metadata,
      });
      return {
        update: (data: {
          output?: unknown;
          usage?: { input?: number; output?: number };
          metadata?: Record<string, unknown>;
        }) =>
          gen.update({
            output: data.output,
            usage: data.usage,
            metadata: data.metadata,
          }),
        end: () => gen.end(),
      };
    },
    update: (data: { output?: unknown; metadata?: Record<string, unknown> }) =>
      trace.update({ output: data.output, metadata: data.metadata }),
    end: async () => {
      // Langfuse SDK flush async — đảm bảo events được gửi trước khi serverless lambda dừng
      await client.flushAsync();
    },
  };
}

/** No-op trace dùng khi Langfuse tắt — cùng signature, không làm gì. */
function noOpTrace() {
  const noOpSpan = {
    update: () => undefined,
    end: () => undefined,
  };
  return {
    span: () => noOpSpan,
    generation: () => noOpSpan,
    update: () => undefined,
    end: async () => undefined,
  };
}

export type Trace = ReturnType<typeof startTrace>;
