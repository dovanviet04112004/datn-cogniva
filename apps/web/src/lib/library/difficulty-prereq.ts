/**
 * library/difficulty-prereq — Phase 3 Bonus #13 (2026-05-27).
 *
 * Auto-detect 2 thuộc tính cho doc:
 *
 *   1. **Difficulty** (easy/medium/hard): tính từ atom difficulty mix +
 *      page count + doc_type. Pure heuristic, không cần LLM.
 *
 *   2. **Prerequisite atoms**: LLM scan title + summary + sample chunks →
 *      đề xuất atom slugs user CẦN BIẾT TRƯỚC khi đọc doc. Lưu vào
 *      `library_doc.prerequisite_atom_slugs`.
 *
 * UI hệ quả:
 *   - Badge "Khó/Vừa/Dễ" trên doc card + detail
 *   - Filter `?difficulty=easy|medium|hard` trên /library grid
 *   - Cảnh báo "Cần biết Atom X, Y trước" trên detail nếu user thiếu prereq
 *     (Phase 3 — cross-reference với workspace mastery)
 *
 * Spec: docs/plans/library-share.md §Bonus 13.
 */
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db, libraryDoc, libraryDocAtom } from '@cogniva/db';

import { routedGenerateText } from '@/lib/ai/router';

// ─── 1. Difficulty heuristic ─────────────────────────────────────────
export type Difficulty = 'easy' | 'medium' | 'hard';

/**
 * Compute difficulty từ atom mix + page count + doc_type.
 *
 * Weighted score:
 *   - Atom difficulty mix: avg(hard=2, medium=1, easy=0)
 *   - Page count tier: <20 → 0, 20-50 → 0.3, 50+ → 0.5
 *   - Doc-type bias: 'exam'/'thesis' → +0.3, 'summary'/'mind_map' → -0.2
 *
 * Final score 0..2.5 → bucket:
 *   < 0.7 → easy
 *   0.7..1.4 → medium
 *   > 1.4 → hard
 */
export function computeDifficulty(input: {
  atomDifficulties: Array<Difficulty | null>;
  pageCount: number | null;
  docType: string;
}): Difficulty {
  // Atom mix score
  let atomScore = 0;
  let validAtoms = 0;
  for (const d of input.atomDifficulties) {
    if (!d) continue;
    validAtoms++;
    if (d === 'hard') atomScore += 2;
    else if (d === 'medium') atomScore += 1;
  }
  const atomAvg = validAtoms > 0 ? atomScore / validAtoms : 0.8; // default medium-ish

  // Page tier
  const pc = input.pageCount ?? 0;
  const pageScore = pc < 20 ? 0 : pc < 50 ? 0.3 : 0.5;

  // Doc-type bias
  const t = input.docType;
  const typeBias =
    t === 'exam' || t === 'thesis'
      ? 0.3
      : t === 'summary' || t === 'mind_map'
        ? -0.2
        : 0;

  const score = atomAvg + pageScore + typeBias;

  if (score < 0.7) return 'easy';
  if (score < 1.4) return 'medium';
  return 'hard';
}

// ─── 2. Prerequisite atom extraction (LLM) ───────────────────────────
const PREREQ_SYSTEM = `Bạn là chuyên gia phân tích tài liệu học tập.

Nhiệm vụ: đọc tài liệu, xác định 2-5 KHÁI NIỆM/KỸ NĂNG user CẦN BIẾT TRƯỚC khi đọc tài liệu này.

Ví dụ:
  - Doc "Tích phân nâng cao" → prerequisite: "đạo hàm cơ bản", "giới hạn hàm số"
  - Doc "React hooks" → prerequisite: "javascript es6+", "react component cơ bản"
  - Doc "IELTS Writing Task 2" → prerequisite: "ngữ pháp tiếng anh cơ bản", "tense"

Yêu cầu output JSON:
{
  "prerequisites": [
    "atom name 1 (ngắn gọn, 2-8 từ)",
    "atom name 2",
    ...
  ]
}

Quy tắc:
- Tối thiểu 2, tối đa 5 atom
- Mỗi atom viết thường, tiếng Việt (trừ thuật ngữ chuyên ngành)
- KHÔNG markdown, CHỈ JSON
- Nếu doc là cơ bản nhất → trả [] (không có prereq)`;

const PrereqSchema = z.object({
  prerequisites: z.array(z.string().min(2).max(80)).max(5),
});

/**
 * Extract prerequisite atom slugs từ doc bằng LLM.
 *
 * Returns mảng atom slugs (slugified) lưu vào library_doc.prerequisite_atom_slugs.
 */
export async function extractPrerequisitesForDoc(
  docId: string,
): Promise<{ prereqSlugs: string[]; costUsd: number; modelUsed: string }> {
  const [doc] = await db
    .select({
      id: libraryDoc.id,
      uploaderId: libraryDoc.uploaderId,
      title: libraryDoc.title,
      subjectSlug: libraryDoc.subjectSlug,
      level: libraryDoc.level,
      aiSummary: libraryDoc.aiSummary,
      previewText: libraryDoc.previewText,
    })
    .from(libraryDoc)
    .where(eq(libraryDoc.id, docId))
    .limit(1);
  if (!doc) throw new Error(`Doc not found: ${docId}`);

  const userMsg = `Tài liệu: "${doc.title}"
Môn: ${doc.subjectSlug}
Cấp: ${doc.level}

AI tóm tắt:
${doc.aiSummary ?? '(chưa có)'}

Nội dung mẫu:
${(doc.previewText ?? '').slice(0, 1500)}

Liệt kê prerequisite atoms.`;

  const { text, costUsd, modelId } = await routedGenerateText({
    useCase: 'classify',
    userId: doc.uploaderId,
    plan: 'FREE',
    system: PREREQ_SYSTEM,
    messages: [{ role: 'user', content: userMsg }],
    maxOutputTokens: 400,
    feature: 'library.prereq.extract',
  });

  // Parse JSON
  const jsonText = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  let parsed: z.infer<typeof PrereqSchema>;
  try {
    parsed = PrereqSchema.parse(JSON.parse(jsonText));
  } catch (err) {
    throw new Error(`Prereq JSON parse fail: ${(err as Error).message}`);
  }

  // Slugify
  const slugs = parsed.prerequisites
    .map(slugifyAtom)
    .filter((s) => s.length > 0);
  const dedupedSlugs = Array.from(new Set(slugs));

  // Persist
  await db
    .update(libraryDoc)
    .set({
      prerequisiteAtomSlugs: dedupedSlugs,
      updatedAt: new Date(),
    })
    .where(eq(libraryDoc.id, docId));

  return { prereqSlugs: dedupedSlugs, costUsd, modelUsed: modelId };
}

// ─── 3. Combined recompute (difficulty + prereq) ─────────────────────
export async function recomputeDifficultyAndPrereqForDoc(
  docId: string,
): Promise<{
  difficulty: Difficulty;
  prereqSlugs: string[];
  costUsd: number;
}> {
  // Get atom difficulties
  const atoms = await db
    .select({ difficulty: libraryDocAtom.difficulty })
    .from(libraryDocAtom)
    .where(eq(libraryDocAtom.docId, docId));

  const [doc] = await db
    .select({
      pageCount: libraryDoc.pageCount,
      docType: libraryDoc.docType,
    })
    .from(libraryDoc)
    .where(eq(libraryDoc.id, docId))
    .limit(1);
  if (!doc) throw new Error(`Doc not found: ${docId}`);

  const difficulty = computeDifficulty({
    atomDifficulties: atoms.map((a) => a.difficulty as Difficulty | null),
    pageCount: doc.pageCount,
    docType: doc.docType,
  });

  // Persist difficulty
  await db
    .update(libraryDoc)
    .set({ difficulty, updatedAt: new Date() })
    .where(eq(libraryDoc.id, docId));

  // Extract prereqs (LLM)
  const { prereqSlugs, costUsd } = await extractPrerequisitesForDoc(docId);

  return { difficulty, prereqSlugs, costUsd };
}

// ─── 4. Find missing prerequisites cho user ──────────────────────────
/**
 * Cross-reference user's mastered atom slugs với doc's prerequisite list.
 * Trả về list prereq slugs user CHƯA master.
 *
 * Pattern: dùng concept embedding similarity (như atom-map) — nếu user có
 * concept tương ứng với mastery.score >= 0.6 → coi như đã có.
 *
 * Để đơn giản v1: chỉ check slug exact match với library_doc_atom slugs đã
 * có (atom_slug là kết quả slugify cùng phương pháp, dedup cross-doc).
 *
 * Phase 3.5 sẽ enhance: match concept embedding similarity.
 */
export async function findMissingPrereqs(
  docId: string,
  userId: string,
): Promise<string[]> {
  const [doc] = await db
    .select({
      prereqSlugs: libraryDoc.prerequisiteAtomSlugs,
    })
    .from(libraryDoc)
    .where(eq(libraryDoc.id, docId))
    .limit(1);
  if (!doc?.prereqSlugs || doc.prereqSlugs.length === 0) return [];

  // Find atoms user đã master qua import → atom mastery cross-table.
  // Heuristic v1: user "master" 1 atom nếu họ đã import 1 doc chứa atom slug
  // đó VÀ doc đó dạng theory (cover concept).
  // Build Postgres array literal để escape an toàn
  const slugList = doc.prereqSlugs
    .map((s) => `"${s.replace(/"/g, '\\"')}"`)
    .join(',');

  const masteredRows = await db.execute(
    sql`
      SELECT DISTINCT atom_slug
      FROM library_doc_atom a
      JOIN library_doc_import imp ON imp.doc_id = a.doc_id
      WHERE imp.importer_id = ${userId}
        AND atom_slug = ANY(('{' || ${slugList} || '}')::text[])
    `,
  );
  const masteredSlugs = new Set(
    (masteredRows as unknown as Array<{ atom_slug: string }>).map((r) => r.atom_slug),
  );

  return doc.prereqSlugs.filter((s) => !masteredSlugs.has(s));
}

// ─── 5. Slugify (same logic as atom-extractor) ───────────────────────
function slugifyAtom(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

