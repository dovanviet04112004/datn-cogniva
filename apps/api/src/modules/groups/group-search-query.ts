/**
 * Parser query search message trong group — port phần SERVER dùng từ
 * apps/web/src/lib/group/search-query.ts (NGUỒN CHUẨN — client còn dùng bản
 * gốc để preview chip; đổi cú pháp filter thì sửa CẢ HAI). stringifySearch
 * (render chip) là client-only nên không port.
 *
 * Cú pháp Discord-inspired: "react from:abc in:ch has:image before:2026-05-01".
 * Supported keys: from, in, has, before, after, mentions.
 */

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

  // Tokenize theo whitespace (single pass — không xử lý quoted strings để gọn)
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
        textParts.push(tok); // invalid → treat as plain text
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

/**
 * Convert text query → Postgres tsquery format: word `&` word, escape ký tự
 * đặc biệt, append `:*` wildcard prefix. "react hook" → "react:* & hook:*".
 */
export function toTsQuery(text: string): string {
  const cleaned = text
    .replace(/[&|!():*<>]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (cleaned.length === 0) return '';
  return cleaned.map((w) => `${w}:*`).join(' & ');
}
