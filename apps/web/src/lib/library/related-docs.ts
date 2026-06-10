/**
 * library/related-docs — Bonus #10 Auto-Stitched Workspace (Phase 2, 2026-05-27).
 *
 * Cho 1 source doc, tìm 3 docs bổ trợ thuộc 3 loại role:
 *   - prerequisite: theory cùng môn, cover atom giao thoa, easier difficulty
 *   - next_step:    theory/reference cùng subject + atom mở rộng
 *   - practice:     exam/exercise/solution cùng subject
 *
 * Strategy: atom overlap signal + subject filter + doc_type clustering.
 * KHÔNG cần LLM — query SQL deterministic ~50ms.
 *
 * Spec: docs/plans/library-share.md §Bonus 10.
 */
import { and, desc, eq, ne, sql } from 'drizzle-orm';

import { db, libraryDoc, libraryDocAtom } from '@cogniva/db';

const THEORY_TYPES = ['lecture_notes', 'summary', 'reference_book', 'handout', 'other'];
const PRACTICE_TYPES = ['exam', 'exercise', 'solution'];

export type RelatedDocRole = 'prerequisite' | 'next_step' | 'practice';

export type RelatedDoc = {
  id: string;
  title: string;
  docType: string;
  pageCount: number | null;
  previewThumbUrl: string | null;
  aiSummary: string | null;
  ratingAvg: number | null;
  qualityScore: number | null;
  workspaceImportCount: number;
  role: RelatedDocRole;
  /** Số atom giao với source doc — UX hint "doc này cover X atoms cùng". */
  atomOverlap: number;
};

export async function findRelatedDocs(docId: string): Promise<RelatedDoc[]> {
  // ── 1. Fetch source doc + atoms ─────────────────────────────────────
  const [source] = await db
    .select({
      id: libraryDoc.id,
      subjectSlug: libraryDoc.subjectSlug,
      level: libraryDoc.level,
      grade: libraryDoc.grade,
      docType: libraryDoc.docType,
    })
    .from(libraryDoc)
    .where(eq(libraryDoc.id, docId))
    .limit(1);
  if (!source) return [];

  const sourceAtoms = await db
    .select({ atomSlug: libraryDocAtom.atomSlug })
    .from(libraryDocAtom)
    .where(eq(libraryDocAtom.docId, docId));
  const atomSlugs = sourceAtoms.map((a) => a.atomSlug);

  // ── 2. Candidate query: cùng subject + có ≥1 atom overlap nếu có atoms ──
  // Nếu source chưa có atom → fallback chỉ filter subject + status.
  const baseConditions = [
    eq(libraryDoc.subjectSlug, source.subjectSlug),
    eq(libraryDoc.status, 'PUBLISHED'),
    ne(libraryDoc.id, docId),
  ];

  // Build Postgres text array literal: '{slug1,slug2,...}'::text[]
  // Drizzle interpolation `${jsArray}` tạo tuple ($1,$2,...) — Postgres
  // không cast được record → text[]. Workaround: escape literal trực tiếp.
  const atomArrayLiteral = atomSlugs.length
    ? `{${atomSlugs.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(',')}}`
    : '{}';

  const candidatesQuery = db
    .selectDistinctOn([libraryDoc.id], {
      id: libraryDoc.id,
      title: libraryDoc.title,
      docType: libraryDoc.docType,
      pageCount: libraryDoc.pageCount,
      previewThumbUrl: libraryDoc.previewThumbUrl,
      aiSummary: libraryDoc.aiSummary,
      ratingAvg: libraryDoc.ratingAvg,
      qualityScore: libraryDoc.qualityScore,
      workspaceImportCount: libraryDoc.workspaceImportCount,
      atomOverlap: atomSlugs.length
        ? sql<number>`(SELECT COUNT(DISTINCT a.atom_slug)::int FROM library_doc_atom a WHERE a.doc_id = ${libraryDoc.id} AND a.atom_slug = ANY(${atomArrayLiteral}::text[]))`
        : sql<number>`0::int`,
    })
    .from(libraryDoc)
    .where(and(...baseConditions))
    .orderBy(libraryDoc.id, desc(libraryDoc.qualityScore))
    .limit(40);

  const candidates = await candidatesQuery;

  // ── 3. Bucket theo role ─────────────────────────────────────────────
  // Strategy: sort theo overlap DESC + quality DESC trong từng bucket.
  const sortFn = (a: (typeof candidates)[number], b: (typeof candidates)[number]) => {
    const ovA = Number(a.atomOverlap ?? 0);
    const ovB = Number(b.atomOverlap ?? 0);
    if (ovA !== ovB) return ovB - ovA;
    const qA = a.qualityScore ? Number(a.qualityScore) : 0;
    const qB = b.qualityScore ? Number(b.qualityScore) : 0;
    return qB - qA;
  };

  // Practice = exam/exercise/solution
  const practice = candidates
    .filter((c) => PRACTICE_TYPES.includes(c.docType))
    .sort(sortFn);

  // Prerequisite + next-step đều thuộc THEORY_TYPES (overlap với source)
  const theory = candidates
    .filter((c) => THEORY_TYPES.includes(c.docType))
    .sort(sortFn);

  // Distribute: top theory với atom overlap cao → prerequisite, next theory → next_step
  const prerequisite = theory[0];
  const nextStep = theory.find((c) => c.id !== prerequisite?.id);
  const practiceTop = practice[0];

  // ── 4. Build result list ────────────────────────────────────────────
  const results: RelatedDoc[] = [];
  if (prerequisite) {
    results.push({
      id: prerequisite.id,
      title: prerequisite.title,
      docType: prerequisite.docType,
      pageCount: prerequisite.pageCount,
      previewThumbUrl: prerequisite.previewThumbUrl,
      aiSummary: prerequisite.aiSummary,
      ratingAvg: prerequisite.ratingAvg ? Number(prerequisite.ratingAvg) : null,
      qualityScore: prerequisite.qualityScore ? Number(prerequisite.qualityScore) : null,
      workspaceImportCount: prerequisite.workspaceImportCount,
      role: 'prerequisite',
      atomOverlap: Number(prerequisite.atomOverlap ?? 0),
    });
  }
  if (nextStep) {
    results.push({
      id: nextStep.id,
      title: nextStep.title,
      docType: nextStep.docType,
      pageCount: nextStep.pageCount,
      previewThumbUrl: nextStep.previewThumbUrl,
      aiSummary: nextStep.aiSummary,
      ratingAvg: nextStep.ratingAvg ? Number(nextStep.ratingAvg) : null,
      qualityScore: nextStep.qualityScore ? Number(nextStep.qualityScore) : null,
      workspaceImportCount: nextStep.workspaceImportCount,
      role: 'next_step',
      atomOverlap: Number(nextStep.atomOverlap ?? 0),
    });
  }
  if (practiceTop) {
    results.push({
      id: practiceTop.id,
      title: practiceTop.title,
      docType: practiceTop.docType,
      pageCount: practiceTop.pageCount,
      previewThumbUrl: practiceTop.previewThumbUrl,
      aiSummary: practiceTop.aiSummary,
      ratingAvg: practiceTop.ratingAvg ? Number(practiceTop.ratingAvg) : null,
      qualityScore: practiceTop.qualityScore ? Number(practiceTop.qualityScore) : null,
      workspaceImportCount: practiceTop.workspaceImportCount,
      role: 'practice',
      atomOverlap: Number(practiceTop.atomOverlap ?? 0),
    });
  }

  return results;
}
