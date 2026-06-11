import type { TranscribeSegment } from './whisper.service';

export type Chapter = {
  startSec: number;
  endSec: number;
  title: string;
  preview: string;
};

export type ChapterDetectionOptions = {
  blockSec?: number;
  similarityThreshold?: number;
  minChapterSec?: number;
  embedFn: (text: string) => Promise<number[]>;
};

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

function makeTitle(text: string): string {
  const words = text.trim().split(/\s+/).slice(0, 10);
  if (words.length === 0) return 'Chương';
  const raw = words
    .join(' ')
    .replace(/[.,;!?]+$/, '')
    .trim();
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export async function detectChapters(
  segments: TranscribeSegment[],
  opts: ChapterDetectionOptions,
): Promise<Chapter[]> {
  const { blockSec = 75, similarityThreshold = 0.65, minChapterSec = 120, embedFn } = opts;

  if (segments.length === 0) return [];

  const blocks = buildBlocks(segments, blockSec);
  if (blocks.length <= 1) {
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

  const embeddings = await Promise.all(blocks.map((b) => embedFn(b.text)));

  const boundaryIdx: number[] = [0];
  for (let i = 1; i < blocks.length; i++) {
    const sim = cosine(embeddings[i - 1]!, embeddings[i]!);
    if (sim < similarityThreshold) boundaryIdx.push(i);
  }

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
      last.endSec = candidate.endSec;
      last.preview = (last.preview + ' ' + candidate.preview).slice(0, 200);
    } else {
      chapters.push(candidate);
    }
  }

  return chapters;
}
