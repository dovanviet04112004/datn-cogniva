import OpenAI from 'openai';
import { VoyageAIClient } from 'voyageai';

const EMBED_DIM = 1024;

let _voyage: VoyageAIClient | undefined;
let _openai: OpenAI | undefined;

type Provider = 'voyage' | 'openai';

function pickProvider(): Provider {
  const forced = process.env.EMBEDDING_PROVIDER as Provider | undefined;
  if (forced === 'voyage' || forced === 'openai') return forced;
  if (process.env.VOYAGE_API_KEY) return 'voyage';
  if (process.env.OPENAI_API_KEY) return 'openai';
  throw new Error('[embed-query] Cần VOYAGE_API_KEY hoặc OPENAI_API_KEY trong env');
}

function getVoyage(): VoyageAIClient {
  if (_voyage) return _voyage;
  _voyage = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY! });
  return _voyage;
}

function getOpenAI(): OpenAI {
  if (_openai) return _openai;
  _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  return _openai;
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

export async function embedQuery(text: string): Promise<number[]> {
  const provider = pickProvider();
  const MAX_RETRIES = 2;
  const BACKOFF_MS = [21_000, 42_000];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (provider === 'voyage') {
        const response = await getVoyage().embed({
          input: [text],
          model: 'voyage-3',
          inputType: 'query',
        });
        const embedding = response.data?.[0]?.embedding;
        if (!embedding) throw new Error('[embed-query] Voyage trả response thiếu embedding');
        return embedding;
      }

      const response = await getOpenAI().embeddings.create({
        model: 'text-embedding-3-large',
        dimensions: EMBED_DIM,
        input: text,
      });
      const embedding = response.data[0]?.embedding;
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
