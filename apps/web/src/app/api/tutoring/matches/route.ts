/**
 * GET /api/tutoring/matches?requestId=... — AI-suggested tutor matches.
 *
 * Logic (plan §7.8):
 *   1. Đảm bảo request.embedding tồn tại (lazy compute từ description).
 *   2. Đảm bảo các candidate tutor có bio_embedding (lazy compute từ bio).
 *   3. Filter pre: cùng subject_slug + level → narrow candidates.
 *   4. Cosine similarity bằng pgvector operator <=> (smaller = closer).
 *   5. Return top 5 với score (1 - cosine_distance).
 *
 * Pattern: lazy embedding để không phải BullMQ cron (V2 đơn giản). Khi tutor
 * count > 10K → cần precompute (xem plan §8.4 — migration scale).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, isNull, sql } from 'drizzle-orm';

import {
  db,
  SUBJECT_BY_SLUG,
  tutorProfile,
  tutorRequest,
  tutorSubject,
  user as userTable,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { embedQuery } from '@/lib/ingest/embed-query';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const requestId = url.searchParams.get('requestId');
  if (!requestId) {
    return NextResponse.json({ error: 'requestId required' }, { status: 400 });
  }

  // 1. Load request
  const [req] = await db
    .select()
    .from(tutorRequest)
    .where(eq(tutorRequest.id, requestId))
    .limit(1);
  if (!req) return NextResponse.json({ error: 'Request not found' }, { status: 404 });

  // 2. Lazy compute request embedding nếu chưa có
  let reqEmbedding: number[];
  if (req.embedding && req.embedding.length === 1024) {
    reqEmbedding = req.embedding;
  } else {
    const subjectName = SUBJECT_BY_SLUG[req.subjectSlug]?.name ?? req.subjectSlug;
    reqEmbedding = await embedQuery(
      `${subjectName} ${req.level}\n${req.title}\n${req.description}`,
    );
    await db
      .update(tutorRequest)
      .set({ embedding: reqEmbedding })
      .where(eq(tutorRequest.id, requestId));
  }

  // 3. Find tutor candidates dạy môn + level này, status PUBLISHED.
  //    Lazy compute bio_embedding cho candidate chưa có.
  const candidates = await db
    .select({
      id: tutorProfile.id,
      bio: tutorProfile.bio,
      headline: tutorProfile.headline,
      bioEmbedding: tutorProfile.bioEmbedding,
    })
    .from(tutorProfile)
    .innerJoin(tutorSubject, eq(tutorSubject.tutorId, tutorProfile.id))
    .where(
      and(
        eq(tutorProfile.status, 'PUBLISHED'),
        eq(tutorSubject.subjectSlug, req.subjectSlug),
        eq(tutorSubject.level, req.level),
      ),
    )
    .limit(50); // pre-filter cap

  // Lazy embed tutor bio nếu thiếu
  for (const c of candidates) {
    if (!c.bioEmbedding || c.bioEmbedding.length !== 1024) {
      const emb = await embedQuery(`${c.headline}\n${c.bio}`);
      await db
        .update(tutorProfile)
        .set({ bioEmbedding: emb })
        .where(eq(tutorProfile.id, c.id));
    }
  }

  if (candidates.length === 0) {
    return NextResponse.json({ matches: [] });
  }

  // 4. Cosine sim via pgvector — chỉ rank các candidate đã có embedding
  const embStr = `[${reqEmbedding.join(',')}]`;
  const ranked = await db
    .select({
      id: tutorProfile.id,
      headline: tutorProfile.headline,
      hourlyRateVnd: tutorProfile.hourlyRateVnd,
      modality: tutorProfile.modality,
      avatarUrl: tutorProfile.avatarUrl,
      ratingAvg: tutorProfile.ratingAvg,
      ratingCount: tutorProfile.ratingCount,
      sessionsCompleted: tutorProfile.sessionsCompleted,
      verificationStatus: tutorProfile.verificationStatus,
      userName: userTable.name,
      // Score = 1 - cosine_distance (higher = better; -1..1 range)
      score: sql<number>`1 - (${tutorProfile.bioEmbedding} <=> ${embStr}::vector)`,
    })
    .from(tutorProfile)
    .innerJoin(userTable, eq(userTable.id, tutorProfile.userId))
    .innerJoin(tutorSubject, eq(tutorSubject.tutorId, tutorProfile.id))
    .where(
      and(
        eq(tutorProfile.status, 'PUBLISHED'),
        eq(tutorSubject.subjectSlug, req.subjectSlug),
        eq(tutorSubject.level, req.level),
        // Skip tutor chưa có embedding (defensive — đã compute ở trên)
        sql`${tutorProfile.bioEmbedding} IS NOT NULL`,
      ),
    )
    .orderBy(sql`${tutorProfile.bioEmbedding} <=> ${embStr}::vector`)
    .limit(5);

  // Filter score < 0.3 (yếu) — nếu hết thì return rỗng có CTA "browse"
  const matches = ranked.filter((m) => Number(m.score) > 0.3);

  return NextResponse.json({
    matches: matches.map((m) => ({
      tutorId: m.id,
      headline: m.headline,
      hourlyRateVnd: m.hourlyRateVnd,
      modality: m.modality,
      avatarUrl: m.avatarUrl,
      ratingAvg: m.ratingAvg ? Number(m.ratingAvg) : null,
      ratingCount: m.ratingCount,
      sessionsCompleted: m.sessionsCompleted,
      verificationStatus: m.verificationStatus,
      name: m.userName,
      score: Math.round(Number(m.score) * 100) / 100,
    })),
  });
}
