export type SearchFilters = {
  from?: string;
  in?: string;
  has?: 'image' | 'file' | 'audio' | 'video';
  before?: string;
  after?: string;
  mentions?: string;
};

export type ParsedSearch = {
  text: string;
  filters: SearchFilters;
};

const FILTER_KEYS = ['from', 'in', 'has', 'before', 'after', 'mentions'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

const HAS_VALUES = ['image', 'file', 'audio', 'video'] as const;

export function parseSearch(input: string): ParsedSearch {
  const filters: SearchFilters = {};
  const textParts: string[] = [];

  const tokens = input.trim().split(/\s+/).filter(Boolean);

  for (const tok of tokens) {
    const colonIdx = tok.indexOf(':');
    if (colonIdx <= 0 || colonIdx === tok.length - 1) {
      textParts.push(tok);
      continue;
    }
    const key = tok.slice(0, colonIdx).toLowerCase() as FilterKey;
    const value = tok.slice(colonIdx + 1);
    if (!FILTER_KEYS.includes(key)) {
      textParts.push(tok);
      continue;
    }
    if (key === 'has') {
      if (!(HAS_VALUES as readonly string[]).includes(value)) {
        textParts.push(tok);
        continue;
      }
      filters.has = value as SearchFilters['has'];
    } else {
      filters[key] = value;
    }
  }

  return {
    text: textParts.join(' '),
    filters,
  };
}

export function stringifySearch(parsed: ParsedSearch): string {
  const parts: string[] = [];
  if (parsed.text) parts.push(parsed.text);
  for (const k of FILTER_KEYS) {
    const v = parsed.filters[k];
    if (v) parts.push(`${k}:${v}`);
  }
  return parts.join(' ');
}

export function toTsQuery(text: string): string {
  const cleaned = text
    .replace(/[&|!():*<>]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (cleaned.length === 0) return '';
  return cleaned.map((w) => `${w}:*`).join(' & ');
}
