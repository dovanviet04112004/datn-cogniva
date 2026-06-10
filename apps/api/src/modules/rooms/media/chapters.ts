/**
 * Auto-chapter detection — copy NGUYÊN từ apps/web/src/lib/media/chapters.ts.
 * Pure functions (không cần DI): block 60-90s → embed → cosine similarity
 * giữa block kề nhau, < threshold (0.65) = topic shift = chapter boundary.
 * Embedding-based thay vì LLM end-to-end: rẻ + deterministic.
 */
import type { TranscribeSegment } from './whisper.service';

export type Chapter = {
  /** Giây bắt đầu chapter (= block đầu của chapter). */
  startSec: number;
  /** Giây kết thúc. */
  endSec: number;
  /** Tiêu đề ngắn, hiển thị trong sidebar. */
  title: string;
  /** Text snippet (3-5 câu đầu) — preview hover. */
  preview: string;
};

export type ChapterDetectionOptions = {
  /** Độ dài block (giây) trước khi gom làm 1 unit embed. Default 75s. */
  blockSec?: number;
  /** Threshold cosine similarity — < ngưỡng = topic shift. Default 0.65. */
  similarityThreshold?: number;
  /** Tối thiểu chapter length (giây) — tránh fragment quá nhỏ. Default 120s. */
  minChapterSec?: number;
  /** Async function trả về embedding cho 1 đoạn text. Pipeline truyền vào. */
  embedFn: (text: string) => Promise<number[]>;
};

/** Cosine similarity giữa 2 vector cùng số chiều. Trả -1 nếu zero vector. */
function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return -1;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) return -1;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Group segments thành blocks ~`blockSec` giây. */
function buildBlocks(
  segments: TranscribeSegment[],
  blockSec: number,
): Array<{ start: number; end: number; text: string }> {
  const blocks: Array<{ start: number; end: number; text: string }> = [];
  let cur: { start: number; end: number; text: string } | null = null;

  for (const s of segments) {
    if (!cur) {
      cur = { start: s.start, end: s.end, text: s.text };
      continue;
    }
    if (s.end - cur.start <= blockSec) {
      cur.end = s.end;
      cur.text += ' ' + s.text;
    } else {
      blocks.push(cur);
      cur = { start: s.start, end: s.end, text: s.text };
    }
  }
  if (cur) blocks.push(cur);
  return blocks;
}

/** Title = 6-10 từ đầu chapter, capitalize, bỏ dấu câu cuối. */
function makeTitle(text: string): string {
  const words = text.trim().split(/\s+/).slice(0, 10);
  if (words.length === 0) return 'Chương';
  const raw = words.join(' ').replace(/[.,;!?]+$/, '').trim();
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/**
 * Detect chapters từ transcript segments.
 *
 * @returns Mảng Chapter sort theo startSec
 */
export async function detectChapters(
  segments: TranscribeSegment[],
  opts: ChapterDetectionOptions,
): Promise<Chapter[]> {
  const {
    blockSec = 75,
    similarityThreshold = 0.65,
    minChapterSec = 120,
    embedFn,
  } = opts;

  if (segments.length === 0) return [];

  const blocks = buildBlocks(segments, blockSec);
  if (blocks.length <= 1) {
    // Audio quá ngắn — trả 1 chapter duy nhất
    const onlyBlock = blocks[0]!;
    return [
      {
        startSec: onlyBlock.start,
        endSec: onlyBlock.end,
        title: makeTitle(onlyBlock.text),
        preview: onlyBlock.text.slice(0, 200),
      },
    ];
  }

  // Embed tất cả blocks song song (Voyage rate-limit OK với <100 calls)
  const embeddings = await Promise.all(blocks.map((b) => embedFn(b.text)));

  // Pass 1: tìm boundary indices (i = boundary nếu sim(i, i-1) < threshold)
  const boundaryIdx: number[] = [0]; // chapter đầu luôn bắt từ block 0
  for (let i = 1; i < blocks.length; i++) {
    const sim = cosine(embeddings[i - 1]!, embeddings[i]!);
    if (sim < similarityThreshold) boundaryIdx.push(i);
  }

  // Pass 2: merge chapter ngắn hơn minChapterSec với chapter kế trước
  const chapters: Chapter[] = [];
  for (let k = 0; k < boundaryIdx.length; k++) {
    const startBlockIdx = boundaryIdx[k]!;
    const endBlockIdx = k + 1 < boundaryIdx.length ? boundaryIdx[k + 1]! - 1 : blocks.length - 1;
    const startBlock = blocks[startBlockIdx]!;
    const endBlock = blocks[endBlockIdx]!;
    const text = blocks
      .slice(startBlockIdx, endBlockIdx + 1)
      .map((b) => b.text)
      .join(' ');

    const candidate: Chapter = {
      startSec: Math.floor(startBlock.start),
      endSec: Math.ceil(endBlock.end),
      title: makeTitle(text),
      preview: text.slice(0, 200),
    };

    const last = chapters[chapters.length - 1];
    if (last && candidate.endSec - last.startSec < minChapterSec) {
      // Merge với previous (giữ title của prev — coi như chương cũ kéo dài)
      last.endSec = candidate.endSec;
      last.preview = (last.preview + ' ' + candidate.preview).slice(0, 200);
    } else {
      chapters.push(candidate);
    }
  }

  return chapters;
}
