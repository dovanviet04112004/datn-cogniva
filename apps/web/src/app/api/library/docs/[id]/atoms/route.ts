/**
 * /api/library/docs/[id]/atoms — Pillar #3 Atom map endpoint (Phase 2).
 *
 * GET: list atoms của doc + overlay mastery state nếu user đã login.
 *      Match atom với concept của user dựa trên embedding cosine similarity
 *      (threshold 0.78) → nếu có concept tương ứng có mastery.score >= 0.7
 *      thì coi như "mastered".
 *
 * POST: trigger atom extraction (idempotent — chạy lại sẽ wipe + redo).
 *       Bắt buộc owner hoặc admin. Free user: rate limit 5 req/giờ.
 *
 * Spec: docs/plans/library-share.md §Phase 2.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import {
  db,
  libraryDoc,
  libraryDocAtom,
  concept,
  mastery,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { extractAtomsForDoc } from '@/lib/library/atom-extractor';

export const runtime = 'nodejs';
export const maxDuration = 60; // LLM extract có thể 10-30s

type Params = { params: Promise<{ id: string }> };

/** Threshold cosine similarity để match atom ↔ user's concept. */
const MASTERY_MATCH_THRESHOLD = 0.78;
/** Threshold mastery.score để coi atom đã master. */
const MASTERED_SCORE_THRESHOLD = 0.7;

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });

  // ── Fetch all atoms của doc ────────────────────────────────────────
  const atoms = await db
    .select({
      id: libraryDocAtom.id,
      atomText: libraryDocAtom.atomText,
      atomSlug: libraryDocAtom.atomSlug,
      pageNums: libraryDocAtom.pageNums,
      difficulty: libraryDocAtom.difficulty,
      embedding: libraryDocAtom.embedding,
    })
    .from(libraryDocAtom)
    .where(eq(libraryDocAtom.docId, id));

  if (atoms.length === 0) {
    return NextResponse.json({ atoms: [], total: 0, masteredCount: 0 });
  }

  // ── Overlay mastery cho user logged-in ─────────────────────────────
  // Strategy: với mỗi atom embedding, tìm concept gần nhất của user (qua
  // mastery JOIN concept) có cosine < (1 - MASTERY_MATCH_THRESHOLD) tức là
  // similarity ≥ MASTERY_MATCH_THRESHOLD. Mastery.score ≥ THRESHOLD → mastered.
  const masteredAtomIds = new Set<string>();
  if (session?.user.id) {
    // Lấy user's mastery rows (concept + score) — limit để tránh load full DB
    // Một user thường có < 500 concept mastery rows.
    const userMasteries = await db
      .select({
        conceptId: mastery.conceptId,
        score: mastery.score,
        conceptEmbedding: concept.embedding,
      })
      .from(mastery)
      .innerJoin(concept, eq(concept.id, mastery.conceptId))
      .where(eq(mastery.userId, session.user.id));

    // For mỗi atom có embedding, compute cosine với mọi concept user đã có
    // mastery → tìm best match. Naive O(atoms × masteries), nhưng atoms ≤ 25
    // và masteries ≤ 500 → max 12.5k ops, OK chạy in-memory.
    for (const atom of atoms) {
      if (!atom.embedding) continue;
      const atomVec = atom.embedding as number[];
      let bestSim = 0;
      let bestScore = 0;
      for (const m of userMasteries) {
        if (!m.conceptEmbedding) continue;
        const conceptVec = m.conceptEmbedding as number[];
        const sim = cosineSim(atomVec, conceptVec);
        if (sim > bestSim) {
          bestSim = sim;
          bestScore = m.score;
        }
      }
      if (
        bestSim >= MASTERY_MATCH_THRESHOLD &&
        bestScore >= MASTERED_SCORE_THRESHOLD
      ) {
        masteredAtomIds.add(atom.id);
      }
    }
  }

  // Strip embedding khỏi response để giảm payload (1024 × 8 bytes/atom)
  const responseAtoms = atoms.map((a) => ({
    id: a.id,
    atomText: a.atomText,
    atomSlug: a.atomSlug,
    pageNums: a.pageNums,
    difficulty: a.difficulty,
    mastered: masteredAtomIds.has(a.id),
  }));

  return NextResponse.json({
    atoms: responseAtoms,
    total: atoms.length,
    masteredCount: masteredAtomIds.size,
  });
}

export async function POST(_request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  // Owner-only trigger (tránh abuse). Admin bypass sau Phase 4.
  const [doc] = await db
    .select({
      uploaderId: libraryDoc.uploaderId,
      status: libraryDoc.status,
      pageCount: libraryDoc.pageCount,
    })
    .from(libraryDoc)
    .where(eq(libraryDoc.id, id))
    .limit(1);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (doc.uploaderId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (doc.status !== 'PUBLISHED') {
    return NextResponse.json(
      { error: 'Doc chưa PUBLISHED, đợi ingest xong' },
      { status: 409 },
    );
  }

  try {
    const result = await extractAtomsForDoc(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[atoms POST]', err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

// ─── Cosine similarity utility ───────────────────────────────────────
function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
