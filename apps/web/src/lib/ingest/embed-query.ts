/**
 * Embed query — biến thể của embedBatch dùng cho retrieval thay vì index.
 *
 * Khác biệt với indexing:
 *   - Voyage: `inputType: 'query'` (vs 'document') — model được fine-tune
 *     riêng cho 2 use case, dùng đúng input type tăng recall ~3-5%.
 *   - Chỉ embed 1 string → trả number[] thay vì number[][].
 *
 * OpenAI fallback dùng cùng API embedBatch, không có khái niệm input type
 * (không khác biệt giữa query/document).
 */
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

/**
 * Embed 1 query string. Tự động chọn provider, dùng inputType='query'
 * khi qua Voyage để model tối ưu cho retrieval.
 */
export async function embedQuery(text: string): Promise<number[]> {
  const provider = pickProvider();

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
}
