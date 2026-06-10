/**
 * POST /api/flashcards/generate — AI sinh cards từ chunks.
 *
 * Body:
 *   { documentId?, chunkIds?, conceptId?, type: 'BASIC'|'CLOZE', limit?, coverAll? }
 *
 * Logic:
 *   1. Resolve chunks: conceptId → chunks của atom; documentId → all chunks doc;
 *      chunkIds → by ids. Verify user.id qua join document.
 *   2. Dedup: bỏ chunk đã có thẻ cùng loại.
 *   3. Chọn chunk để gen:
 *      - coverAll=true (Studio gen theo atom): phủ HẾT chunk chưa-có-thẻ, KHÔNG
 *        cap số thẻ — "gen đủ nội dung thì dừng". Vẫn có trần an toàn COVER_ALL_MAX
 *        (chống atom khổng lồ làm timeout/quá tải LLM); phần dư trả ở `remaining`.
 *      - coverAll=false: slice theo limit (default 10, max 50) — tương thích cũ.
 *   4. Gen SONG SONG theo batch (chống timeout) → generateBasicCards/ClozeCards.
 *   5. INSERT all cards vào DB với FSRS init. Trả created/skipped/remaining.
 *
 * Best-effort: 1 chunk fail không crash batch (extractor đã catch nội bộ).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { chunk, chunkConcept, db, document, flashcard } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onAtomChanged, onFlashcardChanged } from '@/lib/cache/invalidate';
import { generateBasicCards, generateClozeCards } from '@/lib/flashcards/generate';
import type { Plan } from '@/lib/observability/cost-guardrail';
import { initFsrsFields } from '@/lib/flashcards/fsrs';
import { checkLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

// Trần an toàn khi coverAll: phủ hết chunk của atom nhưng không vượt số này trong
// 1 request (chống atom khổng lồ → timeout serverless + quá tải LLM free). Atom
// thường vài→vài chục chunk nên gần như luôn phủ trọn; phần dư trả ở `remaining`.
const COVER_ALL_MAX = 40;
// Số chunk gen song song mỗi batch (cân bằng tốc độ vs rate-limit LLM free).
const GEN_CONCURRENCY = 5;

const GENERATE_SCHEMA = z.object({
  documentId: z.string().optional(),
  chunkIds: z.array(z.string()).optional(),
  // ATOM-TARGETED: gen luyện ĐÚNG 1 atom (concept) — resolve chunks của atom đó.
  // Khép vòng lặp "đề xuất atom yếu → 1 click luyện đúng atom".
  conceptId: z.string().optional(),
  type: z.enum(['BASIC', 'CLOZE']).default('BASIC'),
  limit: z.number().int().min(1).max(50).default(10),
  // coverAll=true → bỏ cap `limit`, phủ HẾT chunk chưa-có-thẻ (tới COVER_ALL_MAX).
  // Studio "Tạo thẻ cho atom" bật cờ này để "gen đủ nội dung thì dừng".
  coverAll: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = await checkLimit(`aigen:${session.user.id}`, 'aiGenerate');
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = GENERATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { documentId, chunkIds, conceptId, type, limit, coverAll } = parsed.data;
  if (!documentId && !conceptId && (!chunkIds || chunkIds.length === 0)) {
    return NextResponse.json(
      { error: 'Cần cung cấp documentId, conceptId hoặc chunkIds' },
      { status: 400 },
    );
  }

  // ATOM-TARGETED: resolve chunks của atom (concept) thuộc tài liệu của user →
  // dùng làm scope gen. Ưu tiên hơn documentId nếu cả hai cùng có.
  let atomChunkIds: string[] | null = null;
  if (conceptId) {
    const rows = await db
      .select({ id: chunkConcept.chunkId })
      .from(chunkConcept)
      .innerJoin(chunk, eq(chunk.id, chunkConcept.chunkId))
      .innerJoin(document, eq(document.id, chunk.documentId))
      .where(
        and(
          eq(chunkConcept.conceptId, conceptId),
          eq(document.userId, session.user.id),
        ),
      );
    atomChunkIds = rows.map((r) => r.id);
  }

  // Resolve CANDIDATE chunks (id + workspaceId, KHÔNG kèm content cho nhẹ; KHÔNG
  // limit ở đây — `limit` áp cho chunk CHƯA có thẻ ở bước dedup phía dưới). FC
  // inherit workspaceId của doc nguồn (workspace-centric).
  const candidates = await db
    .select({ id: chunk.id, workspaceId: document.workspaceId })
    .from(chunk)
    .innerJoin(document, eq(document.id, chunk.documentId))
    .where(
      and(
        eq(document.userId, session.user.id),
        conceptId
          ? inArray(chunk.id, atomChunkIds ?? [])
          : documentId
            ? eq(chunk.documentId, documentId)
            : inArray(chunk.id, chunkIds ?? []),
      ),
    );

  if (candidates.length === 0) {
    return NextResponse.json({ created: 0, skipped: 0, total: 0, cards: [] });
  }

  // DEDUP (hệ thống chuẩn): chunk đã có thẻ CÙNG LOẠI của user này → BỎ QUA, không
  // tạo lại bộ thẻ cũ. Trước đây route INSERT thẳng → gen lần 2 đẻ thẻ trùng.
  const candidateIds = candidates.map((c) => c.id);
  const coveredRows = await db
    .select({ id: flashcard.sourceChunkId })
    .from(flashcard)
    .where(
      and(
        eq(flashcard.userId, session.user.id),
        eq(flashcard.cardType, type),
        inArray(flashcard.sourceChunkId, candidateIds),
      ),
    );
  const covered = new Set(coveredRows.map((r) => r.id));
  const uncovered = candidates.filter((c) => !covered.has(c.id));
  const skipped = candidates.length - uncovered.length;

  // coverAll → phủ HẾT chunk chưa-có-thẻ (tới trần an toàn), "gen đủ thì dừng".
  // Ngược lại → cap theo `limit` (tương thích cũ).
  const cap = coverAll ? COVER_ALL_MAX : limit;
  const toGen = uncovered.slice(0, cap);
  // Phần còn dư khi đụng trần (coverAll + atom quá lớn) → báo client để gen tiếp.
  const remaining = uncovered.length - toGen.length;
  if (toGen.length === 0) {
    // Mọi phần (theo loại này) đã có thẻ → không tạo trùng.
    return NextResponse.json({
      created: 0,
      skipped,
      remaining: 0,
      total: candidates.length,
      cards: [],
    });
  }

  // Load content CHỈ cho chunk sẽ gen (nhẹ — không tải content phần đã bỏ qua).
  const toGenIds = toGen.map((c) => c.id);
  const contentRows = await db
    .select({ id: chunk.id, content: chunk.content })
    .from(chunk)
    .where(inArray(chunk.id, toGenIds));
  const contentMap = new Map(contentRows.map((r) => [r.id, r.content]));
  const chunks = toGen.map((c) => ({
    id: c.id,
    content: contentMap.get(c.id) ?? '',
    workspaceId: c.workspaceId,
  }));

  // Phase A8 (Atom-centric): lookup concept_id cho từng chunk qua pivot
  // chunk_concept, chọn concept có strength cao nhất. Map sẽ dùng khi
  // INSERT flashcard để conceptId được set ngay từ lần đầu — không phải
  // backfill như rows cũ. Nếu chunk chưa có concept (extract chưa chạy
  // hoặc atom chưa được tìm thấy), conceptId fall-back NULL — review
  // sẽ skip applyAttempt, không crash.
  const fetchedChunkIds = chunks.map((c) => c.id);
  const conceptLinks = await db
    .select({
      chunkId: chunkConcept.chunkId,
      conceptId: chunkConcept.conceptId,
      strength: chunkConcept.strength,
    })
    .from(chunkConcept)
    .where(inArray(chunkConcept.chunkId, fetchedChunkIds));
  const chunkToConcept = new Map<string, string>();
  for (const link of conceptLinks) {
    const existing = chunkToConcept.get(link.chunkId);
    // Giữ concept có strength cao nhất; nếu = nhau giữ cái gặp trước (stable).
    if (!existing) {
      chunkToConcept.set(link.chunkId, link.conceptId);
    }
  }

  // Generate SONG SONG theo batch (GEN_CONCURRENCY) — khi coverAll phủ nhiều
  // chunk, chạy tuần tự sẽ chạm timeout serverless; batch song song rút ngắn
  // wall-clock mà vẫn ghì rate-limit LLM free. 1 chunk fail → [] (không crash
  // batch). Pass ctx để bật router cache (cùng chunk → cùng cards, scope shared).
  const plan = ((session.user as { plan?: string }).plan ?? 'FREE') as Plan;
  const genCtx = { userId: session.user.id, plan };
  const generator = type === 'BASIC' ? generateBasicCards : generateClozeCards;
  const allCards: {
    type: 'BASIC' | 'CLOZE';
    front: string;
    back: string;
    sourceChunkId: string;
    workspaceId: string | null;
    conceptId: string | null;
  }[] = [];
  for (let i = 0; i < chunks.length; i += GEN_CONCURRENCY) {
    const batch = chunks.slice(i, i + GEN_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (ch) => ({
        ch,
        cards: await generator(ch.content, genCtx).catch(() => []),
      })),
    );
    for (const { ch, cards } of batchResults) {
      // Gen-THEO-ATOM (request có conceptId) → gắn ĐÚNG atom target để mastery atom
      // đó lên. Gen-theo-doc → concept mạnh nhất của chunk.
      const cardConceptId = conceptId ?? chunkToConcept.get(ch.id) ?? null;
      for (const c of cards) {
        if (c.type === 'BASIC') {
          allCards.push({
            type: 'BASIC',
            front: c.front,
            back: c.back,
            sourceChunkId: ch.id,
            workspaceId: ch.workspaceId,
            conceptId: cardConceptId,
          });
        } else {
          // CLOZE: lưu cloze syntax vào front, back rỗng (cloze tự sinh)
          allCards.push({
            type: 'CLOZE',
            front: c.text,
            back: '',
            sourceChunkId: ch.id,
            workspaceId: ch.workspaceId,
            conceptId: cardConceptId,
          });
        }
      }
    }
  }

  // DEDUP nội dung trong CÙNG request: LLM đôi khi sinh 2 thẻ y hệt (cùng type+
  // front+back) từ các chunk khác nhau → bỏ trùng trước khi insert.
  const seenCard = new Set<string>();
  const dedupedCards = allCards.filter((c) => {
    const key = `${c.type}|${c.front.trim().toLowerCase()}|${c.back.trim().toLowerCase()}`;
    if (seenCard.has(key)) return false;
    seenCard.add(key);
    return true;
  });

  if (dedupedCards.length === 0) {
    return NextResponse.json({
      created: 0,
      skipped,
      remaining,
      total: candidates.length,
      cards: [],
    });
  }

  const fsrs = initFsrsFields();
  const inserted = await db
    .insert(flashcard)
    .values(
      dedupedCards.map((c) => ({
        userId: session.user.id,
        workspaceId: c.workspaceId,
        conceptId: c.conceptId,
        front: c.front,
        back: c.back,
        cardType: c.type,
        sourceChunkId: c.sourceChunkId,
        ...fsrs,
      })),
    )
    .returning();

  // Cards mới due=now → flashcard stats + dashboard cardsDue đổi (+ workspace
  // stats). onFlashcardChanged đã bao gồm dashboard. Cards có thể inherit
  // workspace của NHIỀU doc khác nhau (khi chunkIds spanning docs) → fan-out
  // theo từng workspaceId distinct để bust đúng badge stats từng workspace;
  // null = personal (xử lý ở nhánh không-ws của invalidator). (Gen card KHÔNG
  // qua awardXp.)
  const touchedWorkspaces = new Set(inserted.map((c) => c.workspaceId));
  for (const ws of touchedWorkspaces) {
    await onFlashcardChanged(session.user.id, ws);
  }
  // Atom-targeted → FC count của atom đổi → bust atom-view preview.
  if (conceptId) await onAtomChanged(session.user.id, conceptId);
  return NextResponse.json({
    created: inserted.length,
    skipped,
    remaining,
    total: candidates.length,
    cards: inserted,
  });
}
