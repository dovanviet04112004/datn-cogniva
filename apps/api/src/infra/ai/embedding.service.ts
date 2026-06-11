import { Injectable } from '@nestjs/common';

const EMBED_DIM = 1024;
const BATCH_SIZE = 128;

type Provider = 'voyage' | 'openai';
type InputType = 'document' | 'query';

interface EmbeddingsResponse {
  data?: Array<{ embedding?: number[]; index?: number }>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

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

  private async voyageRequest(inputs: string[], inputType: InputType): Promise<EmbeddingsResponse> {
    const apiKey = process.env.VOYAGE_API_KEY;
    if (!apiKey) throw new Error('[ingest/embed] VOYAGE_API_KEY missing');
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ input: inputs, model: 'voyage-3', input_type: inputType }),
    });
    if (!res.ok) throw new Error(`[embedding] voyage ${res.status}`);
    return (await res.json()) as EmbeddingsResponse;
  }

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

  private async embedVoyageBatch(inputs: string[], inputType: InputType): Promise<number[][]> {
    const response = await this.voyageRequest(inputs, inputType);
    if (!response.data) throw new Error('[ingest/embed] Voyage trả response thiếu data');
    const sorted = [...response.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return sorted.map((d) => {
      if (!d.embedding) throw new Error('[ingest/embed] Voyage data item thiếu embedding');
      return d.embedding;
    });
  }

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
