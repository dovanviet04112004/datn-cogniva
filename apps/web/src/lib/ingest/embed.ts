import OpenAI from 'openai';
import { VoyageAIClient } from 'voyageai';

const EMBED_DIM = 1024;
const BATCH_SIZE = 128;

type Provider = 'voyage' | 'openai';

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

async function embedOpenAIBatch(inputs: string[]): Promise<number[][]> {
  const response = await getOpenAI().embeddings.create({
    model: 'text-embedding-3-large',
    dimensions: EMBED_DIM,
    input: inputs,
  });
  const sorted = [...response.data].sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}

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

export function currentProvider(): Provider {
  return pickProvider();
}
