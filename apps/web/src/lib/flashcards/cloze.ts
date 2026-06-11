const CLOZE_REGEX = /\{\{c(\d+)::([^}]+?)(?:::([^}]+?))?\}\}/g;

export type ClozeSegment =
  | { type: 'text'; content: string }
  | { type: 'cloze'; index: number; answer: string; hint?: string };

export function parseCloze(text: string): ClozeSegment[] {
  const segments: ClozeSegment[] = [];
  let lastIndex = 0;
  CLOZE_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = CLOZE_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    segments.push({
      type: 'cloze',
      index: parseInt(match[1]!, 10),
      answer: match[2]!,
      hint: match[3],
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }
  return segments;
}

export function renderClozeText(segments: ClozeSegment[], showIndex: number): string {
  return segments
    .map((seg) => {
      if (seg.type === 'text') return seg.content;
      if (seg.index === showIndex) {
        return seg.hint ? `[${seg.hint}]` : '[...]';
      }
      return seg.answer;
    })
    .join('');
}

export function listClozeIndices(text: string): number[] {
  const indices = new Set<number>();
  CLOZE_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CLOZE_REGEX.exec(text)) !== null) {
    indices.add(parseInt(match[1]!, 10));
  }
  return Array.from(indices).sort((a, b) => a - b);
}
