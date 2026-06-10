/**
 * EmbeddingService — Voyage primary, OpenAI fallback. Port semantics từ
 * apps/web/src/lib/ingest/embed.ts (embedBatch) + embed-query.ts (embedQuery,
 * retry 429). Khác bản web: gọi REST trực tiếp thay vì SDK voyageai/openai
 * (apps/api không cài 2 SDK đó) — request/response shape giữ nguyên.
 *
 * Cả 2 provider đều output vector 1024 chiều (khớp schema vector(1024)):
 *   - Voyage voyage-3 (free 200M token), max 128 input/request.
 *   - OpenAI text-embedding-3-large + dimensions=1024 (Matryoshka truncation).
 * EMBEDDING_PROVIDER=voyage|openai để force; mặc định pick theo key có sẵn.
 */
import { Injectable } from '@nestjs/common';

const EMBED_DIM = 1024;
const BATCH_SIZE = 128;

type Provider = 'voyage' | 'openai';
type InputType = 'document' | 'query';

/** Shape chung của response embeddings (Voyage + OpenAI đều theo format này). */
interface EmbeddingsResponse {
  data?: Array<{ embedding?: number[]; index?: number }>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Detect 429 — REST throw Error có status code trong message (vd "voyage 429"). */
function isRateLimitError(err: unknown): boolean {
  if (!err) return false;
  const message = (err as Error).message ?? '';
  const status =
    (err as { status?: number; statusCode?: number }).status ??
    (err as { statusCode?: number }).statusCode;
  return status === 429 || /429|rate limit/i.test(message);
}

@Injectable()
export class EmbeddingService {
  /**
   * Embed danh sách text, tự chia batch theo BATCH_SIZE. Trả vector cùng độ
   * dài + thứ tự với inputs. inputType default 'document' (indexing) —
   * truyền 'query' khi embed nhiều câu hỏi 1 lượt.
   */
  async embedBatch(texts: string[], inputType: InputType = 'document'): Promise<number[][]> {
    if (texts.length === 0) return [];
    const provider = this.pickProvider('batch');
    const out: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const slice = texts.slice(i, i + BATCH_SIZE);
      const vectors =
        provider === 'voyage'
          ? await this.embedVoyageBatch(slice, inputType)
          : await this.embedOpenAIBatch(slice);
      out.push(...vectors);
    }

    // VALIDATE đầu ra: provider PHẢI trả ĐÚNG số vector + ĐÚNG 1024 chiều — partial
    // response/đổi dimension thì throw để pipeline đánh dấu FAILED, thay vì insert
    // vector rỗng/sai chiều làm hỏng HNSW index + retrieval (bài học từ lib cũ).
    if (out.length !== texts.length) {
      throw new Error(
        `[ingest/embed] provider trả ${out.length} vector cho ${texts.length} input — abort`,
      );
    }
    for (const v of out) {
      if (!Array.isArray(v) || v.length !== EMBED_DIM) {
        throw new Error(
          `[ingest/embed] vector sai chiều: cần ${EMBED_DIM}, nhận ${
            Array.isArray(v) ? v.length : typeof v
          }`,
        );
      }
    }

    return out;
  }

  /**
   * Embed 1 query string cho retrieval — Voyage dùng inputType='query'
   * (model fine-tune riêng, recall tốt hơn ~3-5% so với 'document').
   *
   * Retry logic giữ nguyên embed-query.ts cũ: Voyage free tier 3 RPM → retry
   * tối đa 2 lần khi 429 với delay 21s/42s; lỗi khác throw ngay.
   */
  async embedQuery(text: string): Promise<number[]> {
    const provider = this.pickProvider('query');
    const MAX_RETRIES = 2;
    const BACKOFF_MS = [21_000, 42_000];

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (provider === 'voyage') {
          const response = await this.voyageRequest([text], 'query');
          const embedding = response.data?.[0]?.embedding;
          if (!embedding) throw new Error('[embed-query] Voyage trả response thiếu embedding');
          return embedding;
        }

        const response = await this.openaiRequest(text);
        const embedding = response.data?.[0]?.embedding;
        if (!embedding) throw new Error('[embed-query] OpenAI trả response thiếu embedding');
        return embedding;
      } catch (err) {
        if (isRateLimitError(err) && attempt < MAX_RETRIES) {
          const delay = BACKOFF_MS[attempt]!;
          console.warn(
            `[embed-query] Rate limited, retry sau ${delay / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`,
          );
          await sleep(delay);
          continue;
        }
        throw err;
      }
    }

    throw new Error('[embed-query] Hết retry sau rate limit');
  }

  /**
   * Pick provider theo env. 2 lib cũ có error message khác nhau khi thiếu key
   * — giữ nguyên văn từng context để log/diff không lệch.
   */
  private pickProvider(scope: 'batch' | 'query'): Provider {
    const forced = process.env.EMBEDDING_PROVIDER as Provider | undefined;
    if (forced === 'voyage' || forced === 'openai') return forced;
    if (process.env.VOYAGE_API_KEY) return 'voyage';
    if (process.env.OPENAI_API_KEY) return 'openai';
    if (scope === 'query') {
      throw new Error('[embed-query] Cần VOYAGE_API_KEY hoặc OPENAI_API_KEY trong env');
    }
    throw new Error(
      '[ingest/embed] Không tìm thấy VOYAGE_API_KEY hoặc OPENAI_API_KEY. ' +
        'Thêm 1 trong 2 vào apps/web/.env.local rồi restart dev server. ' +
        'Voyage: https://dash.voyageai.com/api-keys (free 200M token).',
    );
  }

  /** POST Voyage /v1/embeddings — REST tương đương VoyageAIClient.embed(). */
  private async voyageRequest(inputs: string[], inputType: InputType): Promise<EmbeddingsResponse> {
    const apiKey = process.env.VOYAGE_API_KEY;
    if (!apiKey) throw new Error('[ingest/embed] VOYAGE_API_KEY missing');
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ input: inputs, model: 'voyage-3', input_type: inputType }),
    });
    // Status code nằm trong message để isRateLimitError() match /429/ như SDK cũ.
    if (!res.ok) throw new Error(`[embedding] voyage ${res.status}`);
    return (await res.json()) as EmbeddingsResponse;
  }

  /** POST OpenAI /v1/embeddings với dimensions=1024 (truncation từ 3072 native). */
  private async openaiRequest(input: string | string[]): Promise<EmbeddingsResponse> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('[ingest/embed] OPENAI_API_KEY missing');
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'text-embedding-3-large', dimensions: EMBED_DIM, input }),
    });
    if (!res.ok) throw new Error(`[embedding] openai ${res.status}`);
    return (await res.json()) as EmbeddingsResponse;
  }

  /** Embed 1 batch (≤128 input) qua Voyage — sort theo index như lib cũ. */
  private async embedVoyageBatch(inputs: string[], inputType: InputType): Promise<number[][]> {
    const response = await this.voyageRequest(inputs, inputType);
    if (!response.data) throw new Error('[ingest/embed] Voyage trả response thiếu data');
    const sorted = [...response.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return sorted.map((d) => {
      if (!d.embedding) throw new Error('[ingest/embed] Voyage data item thiếu embedding');
      return d.embedding;
    });
  }

  /** Embed 1 batch qua OpenAI — sort theo index như lib cũ. */
  private async embedOpenAIBatch(inputs: string[]): Promise<number[][]> {
    const response = await this.openaiRequest(inputs);
    if (!response.data) throw new Error('[ingest/embed] OpenAI trả response thiếu data');
    const sorted = [...response.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return sorted.map((d) => {
      if (!d.embedding) throw new Error('[ingest/embed] OpenAI data item thiếu embedding');
      return d.embedding;
    });
  }
}
