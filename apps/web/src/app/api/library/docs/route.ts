/**
 * GET /api/library/docs — Library V1 list / search.
 *
 * Query params:
 *   q                 — free-text search
 *   subject, level, grade (multi int), docType (multi), examType, language,
 *   fileFormat (multi), region, schoolYear, minPages, maxPages, minRating
 *   sort              — top|rating|popular|newest
 *   page, per         — pagination (default page=1, per=24)
 *
 * Hybrid: nếu có q → RRF; nếu không → pure filter + sort.
 *
 * Spec: docs/plans/library-share.md §Search Engine.
 */
import { NextResponse } from 'next/server';

import { cached, cacheVersion } from '@/lib/cache/cache-aside';
import { ck, TAG_LIBRARY } from '@/lib/cache/keys';
import { hybridSearchLibraryDocs } from '@/lib/library/hybrid-search-doc';

export const runtime = 'nodejs';

const ALLOWED_PAGE_SIZES = [12, 24, 48, 96];
const DEFAULT_PER = 24;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sp = url.searchParams;

  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1);
  const perRaw = parseInt(sp.get('per') ?? String(DEFAULT_PER), 10);
  const per = ALLOWED_PAGE_SIZES.includes(perRaw) ? perRaw : DEFAULT_PER;
  const offset = (page - 1) * per;

  const query = sp.get('q')?.trim() || undefined;

  const filters = {
    subjectSlug: sp.get('subject') ?? undefined,
    level: sp.get('level') ?? undefined,
    grade: parseIntArray(sp.get('grade')),
    docType: parseStrArray(sp.get('docType')),
    examType: sp.get('examType') ?? undefined,
    schoolYear: sp.get('schoolYear') ?? undefined,
    region: sp.get('region') ?? undefined,
    language: sp.get('language') ?? undefined,
    fileFormat: parseStrArray(sp.get('fileFormat')),
    minPages: sp.get('minPages') ? parseInt(sp.get('minPages')!, 10) : undefined,
    maxPages: sp.get('maxPages') ? parseInt(sp.get('maxPages')!, 10) : undefined,
    minRating: sp.get('minRating') ? parseFloat(sp.get('minRating')!) : undefined,
    tags: parseStrArray(sp.get('tags')),
  };

  const sortParam = sp.get('sort');
  const sort =
    sortParam === 'rating' || sortParam === 'popular' || sortParam === 'newest'
      ? (sortParam as 'rating' | 'popular' | 'newest')
      : 'top';

  try {
    // Fetch nguồn thật — tách thành closure để dùng chung cho cả 2 nhánh
    // (cache vs bypass), tránh lặp shape response.
    const fetchFeed = async () => {
      const result = await hybridSearchLibraryDocs({
        query,
        filters,
        sort,
        limit: per,
        offset,
      });
      return {
        items: result.items,
        total: result.total,
        page,
        per,
        totalPages: Math.max(1, Math.ceil(result.total / per)),
      };
    };

    // ── Cache CHỈ khi q rỗng (filter-only) ────────────────────────────
    // Free-text q tự do cardinality CỰC cao (mỗi chuỗi gõ là 1 key) → cache
    // nhánh query gần như 0% hit + phình Redis; bỏ qua, gọi thẳng nguồn.
    // Nhánh filter-only thì tập filter hữu hạn → cache hiệu quả. Version-fold
    // theo TAG_LIBRARY: doc finalize bump version → mọi key feed cũ mồ côi.
    // Response thuần JSON-serializable (số + string, không Date) → cache an toàn.
    let data;
    if (!query) {
      const filterHash = buildFilterHash(filters, sort, page, per);
      const ver = await cacheVersion(TAG_LIBRARY);
      data = await cached(ck.libraryDocsFeed(filterHash, ver), 300, fetchFeed);
    } else {
      data = await fetchFeed();
    }
    return NextResponse.json(data);
  } catch (err) {
    console.error('[GET /api/library/docs]', err);
    return NextResponse.json(
      { error: 'Search failed', message: (err as Error).message },
      { status: 500 },
    );
  }
}

/**
 * Chuẩn hoá filter+sort+page thành 1 chuỗi hash ổn định cho cache key.
 *
 * Vì sao cần CHUẨN HOÁ (không JSON.stringify thô object filters)?
 *   - Thứ tự key object + thứ tự phần tử mảng (grade/docType/fileFormat/tags)
 *     phải DETERMINISTIC: `?grade=10,11` và `?grade=11,10` cho CÙNG kết quả
 *     → phải ra CÙNG key (tránh phân mảnh cache + miss vô ích).
 *   - Bỏ field undefined để key gọn, không lệ thuộc shape rỗng.
 * Cách làm: sort mảng + duyệt key theo thứ tự cố định → JSON.stringify ổn định.
 */
function buildFilterHash(
  filters: Record<string, unknown>,
  sort: string,
  page: number,
  per: number,
): string {
  // Thứ tự key CỐ ĐỊNH (alphabet) → object literal deterministic khi stringify.
  const norm = {
    docType: sortArr(filters.docType as string[] | undefined),
    examType: filters.examType ?? null,
    fileFormat: sortArr(filters.fileFormat as string[] | undefined),
    grade: sortNumArr(filters.grade as number[] | undefined),
    language: filters.language ?? null,
    level: filters.level ?? null,
    maxPages: filters.maxPages ?? null,
    minPages: filters.minPages ?? null,
    minRating: filters.minRating ?? null,
    region: filters.region ?? null,
    schoolYear: filters.schoolYear ?? null,
    subjectSlug: filters.subjectSlug ?? null,
    tags: sortArr(filters.tags as string[] | undefined),
  };
  return JSON.stringify({ f: norm, sort, page, per });
}

/** Copy + sort mảng string tăng dần (deterministic); undefined → null. */
function sortArr(arr: string[] | undefined): string[] | null {
  return arr && arr.length > 0 ? [...arr].sort() : null;
}

/** Copy + sort mảng số tăng dần (deterministic); undefined → null. */
function sortNumArr(arr: number[] | undefined): number[] | null {
  return arr && arr.length > 0 ? [...arr].sort((a, b) => a - b) : null;
}

function parseStrArray(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseIntArray(raw: string | null): number[] | undefined {
  if (!raw) return undefined;
  return raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
}
