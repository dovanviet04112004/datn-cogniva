/**
 * Embedding — provider abstraction với Voyage AI làm primary, OpenAI làm
 * fallback. Cả 2 đều output vector 1024 chiều (khớp schema vector(1024)).
 *
 * Lựa chọn provider:
 *   1. Nếu có VOYAGE_API_KEY → dùng voyage-3 (Anthropic recommend, free
 *      tier 200M token, không cần thẻ tín dụng).
 *   2. Else nếu có OPENAI_API_KEY → dùng text-embedding-3-large với
 *      `dimensions: 1024` (Matryoshka truncation từ 3072).
 *   3. Cả 2 đều thiếu → throw lỗi rõ ràng.
 *
 * Cấu hình env:
 *   - Bỏ VOYAGE_API_KEY → ép dùng OpenAI fallback (debug / so sánh).
 *   - Set EMBEDDING_PROVIDER=openai để force OpenAI dù có Voyage key.
 *
 * Constraints:
 *   - Voyage: max 128 input/request, 320K total token/request.
 *   - OpenAI: max 2048 input/request.
 *   → Dùng BATCH_SIZE=128 cho cả 2 (an toàn nhất).
 *
 * inputType: 'document' (Voyage) khi index. Phase 2 sẽ thêm 'query' cho
 * câu hỏi từ user — improve retrieval quality theo recommendation của Voyage.
 */
import OpenAI from 'openai';
import { VoyageAIClient } from 'voyageai';

const EMBED_DIM = 1024; // khớp với vector(1024) trong packages/db/src/schema.ts
const BATCH_SIZE = 128;

type Provider = 'voyage' | 'openai';

/**
 * Quyết định provider dựa trên env. Cache lần đầu — không re-evaluate mỗi
 * request (nhưng module sẽ reload khi đổi env, vì ở dev next-themes HMR).
 */
function pickProvider(): Provider {
  const forced = process.env.EMBEDDING_PROVIDER as Provider | undefined;
  if (forced === 'voyage' || forced === 'openai') return forced;
  if (process.env.VOYAGE_API_KEY) return 'voyage';
  if (process.env.OPENAI_API_KEY) return 'openai';
  throw new Error(
    '[ingest/embed] Không tìm thấy VOYAGE_API_KEY hoặc OPENAI_API_KEY. ' +
      'Thêm 1 trong 2 vào apps/web/.env.local rồi restart dev server. ' +
      'Voyage: https://dash.voyageai.com/api-keys (free 200M token).',
  );
}

// Singleton client cache — tránh tạo socket pool mới mỗi request
let _voyage: VoyageAIClient | undefined;
let _openai: OpenAI | undefined;

function getVoyage(): VoyageAIClient {
  if (_voyage) return _voyage;
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error('[ingest/embed] VOYAGE_API_KEY missing');
  _voyage = new VoyageAIClient({ apiKey });
  return _voyage;
}

function getOpenAI(): OpenAI {
  if (_openai) return _openai;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('[ingest/embed] OPENAI_API_KEY missing');
  _openai = new OpenAI({ apiKey });
  return _openai;
}

/**
 * Embed 1 batch (≤128 input) qua Voyage. Trả vector theo cùng order với input.
 */
async function embedVoyageBatch(inputs: string[]): Promise<number[][]> {
  const response = await getVoyage().embed({
    input: inputs,
    model: 'voyage-3',
    inputType: 'document',
  });
  if (!response.data) throw new Error('[ingest/embed] Voyage trả response thiếu data');
  const sorted = [...response.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return sorted.map((d) => {
    if (!d.embedding) throw new Error('[ingest/embed] Voyage data item thiếu embedding');
    return d.embedding;
  });
}

/**
 * Embed 1 batch qua OpenAI text-embedding-3-large với dimensions=1024
 * (Matryoshka truncation từ 3072 native). Khớp schema 1024 dim.
 */
async function embedOpenAIBatch(inputs: string[]): Promise<number[][]> {
  const response = await getOpenAI().embeddings.create({
    model: 'text-embedding-3-large',
    dimensions: EMBED_DIM,
    input: inputs,
  });
  const sorted = [...response.data].sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}

/**
 * Embed danh sách text với provider đã pick. Tự chia batch theo BATCH_SIZE.
 *
 * @param inputs - Mảng text (chunks) cần embed
 * @returns Mảng vector 1024 chiều, cùng độ dài + thứ tự với inputs
 */
export async function embedBatch(inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) return [];
  const provider = pickProvider();
  const out: number[][] = [];

  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    const slice = inputs.slice(i, i + BATCH_SIZE);
    const vectors =
      provider === 'voyage' ? await embedVoyageBatch(slice) : await embedOpenAIBatch(slice);
    out.push(...vectors);
  }

  // VALIDATE đầu ra: provider PHẢI trả ĐÚNG số vector + ĐÚNG 1024 chiều. Nếu nó
  // rớt vài item (partial response) hoặc đổi dimension → throw để pipeline đánh
  // dấu document FAILED, thay vì insert vector RỖNG/sai chiều làm hỏng HNSW index
  // + retrieval (trước đây pipeline `embeddings[i] ?? []` nuốt lỗi → chunk vector rỗng).
  if (out.length !== inputs.length) {
    throw new Error(
      `[ingest/embed] provider trả ${out.length} vector cho ${inputs.length} input — abort`,
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

/** Lấy provider hiện tại (dùng cho log/debug, không có side-effect). */
export function currentProvider(): Provider {
  return pickProvider();
}
