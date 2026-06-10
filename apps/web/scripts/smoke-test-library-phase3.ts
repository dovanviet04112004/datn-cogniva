/**
 * Smoke test Library Phase 3 (2026-05-27).
 *
 * Test 7 mảng — invoke pure logic + (optional) seed sample data để verify
 * end-to-end:
 *   1. Bonus #13 — Difficulty + Prereq: query existing data
 *   2. Bonus #11 — Translate: invoke `routedGenerateText` translate
 *   3. Bonus #7 — Atom graph: query graph endpoint logic
 *   4. Tutor endorsement: seed 1 endorsement → quality recompute → badge check
 *   5. Bonus #9 — Podcast: generate sample script
 *   6. Bonus #8 — Annotation: seed 1 annotation + vote
 *   7. Bonus #12 — Remix + karma: execute remix flow with 2 sources
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env.local scripts/smoke-test-library-phase3.ts
 */
import { randomUUID } from 'node:crypto';
import { eq, desc, sql } from 'drizzle-orm';

import {
  db,
  libraryDoc,
  libraryDocAnnotation,
  libraryDocAnnotationVote,
  libraryDocEndorsement,
  libraryCreatorKarma,
  libraryKarmaEvent,
  tutorProfile,
  user as userTable,
} from '@cogniva/db';

import { awardKarma } from '../src/lib/library/karma';
import { recomputeQualityForDoc } from '../src/lib/library/quality-score';
import { routedGenerateText } from '../src/lib/ai/router';

const HR = '─'.repeat(70);

async function main() {
  console.log('\n🧪 LIBRARY PHASE 3 — SMOKE TEST\n');

  // Pick sample doc + sample tutor
  const [sampleDoc] = await db
    .select({
      id: libraryDoc.id,
      title: libraryDoc.title,
      subjectSlug: libraryDoc.subjectSlug,
      uploaderId: libraryDoc.uploaderId,
      difficulty: libraryDoc.difficulty,
      prereqSlugs: libraryDoc.prerequisiteAtomSlugs,
      badges: libraryDoc.badges,
    })
    .from(libraryDoc)
    .where(eq(libraryDoc.status, 'PUBLISHED'))
    .orderBy(desc(libraryDoc.qualityScore))
    .limit(1);
  if (!sampleDoc) {
    console.log('❌ Không có doc — chạy seed-library-v1.ts trước.');
    return;
  }

  const [sampleTutor] = await db
    .select({
      id: tutorProfile.id,
      userId: tutorProfile.userId,
      name: userTable.name,
    })
    .from(tutorProfile)
    .leftJoin(userTable, eq(userTable.id, tutorProfile.userId))
    .where(eq(tutorProfile.verificationStatus, 'KYC_VERIFIED'))
    .limit(1);

  console.log(`Sample doc: "${sampleDoc.title}" (${sampleDoc.subjectSlug})`);
  if (sampleTutor) {
    console.log(`Sample tutor: ${sampleTutor.name ?? sampleTutor.userId}`);
  }
  console.log(HR);

  // ── 1. Bonus #13 Difficulty + Prereq ─────────────────────────────
  console.log('\n✅ 1) Bonus #13 — Difficulty + Prereq');
  console.log(`   Difficulty: ${sampleDoc.difficulty ?? '(null)'}`);
  console.log(
    `   Prereq atoms (${(sampleDoc.prereqSlugs ?? []).length}):`,
    (sampleDoc.prereqSlugs ?? []).slice(0, 5).map((s) => s.replace(/-/g, ' ')).join(', '),
  );

  // ── 2. Bonus #11 Translate ──────────────────────────────────────
  console.log('\n✅ 2) Bonus #11 — Translate');
  try {
    const { text, costUsd } = await routedGenerateText({
      useCase: 'classify',
      userId: sampleDoc.uploaderId,
      plan: 'FREE',
      system: 'Dịch sang English chính xác, không thêm bình luận. Chỉ trả text dịch.',
      messages: [
        {
          role: 'user',
          content: 'Đạo hàm hàm hợp là quy tắc tính đạo hàm của hàm số kết hợp từ hai hàm số đơn giản.',
        },
      ],
      maxOutputTokens: 200,
      feature: 'smoke-test',
    });
    console.log(`   VI → EN: "${text.trim().slice(0, 100)}..."`);
    console.log(`   Cost: $${costUsd.toFixed(4)}`);
  } catch (err) {
    console.log(`   ✗ ${(err as Error).message}`);
  }

  // ── 3. Bonus #7 Atom Graph ───────────────────────────────────────
  console.log('\n✅ 3) Bonus #7 — Knowledge Graph');
  const graphData = await db.execute<{
    atom_slug: string;
    atom_text: string;
    doc_count: number;
  }>(sql`
    SELECT
      a.atom_slug,
      MIN(a.atom_text) AS atom_text,
      COUNT(DISTINCT a.doc_id)::int AS doc_count
    FROM library_doc_atom a
    JOIN library_doc d ON d.id = a.doc_id
    WHERE d.status = 'PUBLISHED' AND d.subject_slug = ${sampleDoc.subjectSlug}
    GROUP BY a.atom_slug
    ORDER BY doc_count DESC
    LIMIT 5
  `);
  const graphRows = graphData as unknown as Array<{
    atom_slug: string;
    atom_text: string;
    doc_count: number;
  }>;
  console.log(`   Top 5 atoms cho subject "${sampleDoc.subjectSlug}":`);
  for (const a of graphRows) {
    console.log(`     • ${a.atom_text} — ${a.doc_count} doc`);
  }

  const coOccur = await db.execute<{ slug1: string; slug2: string; weight: number }>(sql`
    SELECT a1.atom_slug AS slug1, a2.atom_slug AS slug2, COUNT(DISTINCT a1.doc_id)::int AS weight
    FROM library_doc_atom a1
    JOIN library_doc_atom a2 ON a2.doc_id = a1.doc_id AND a2.atom_slug > a1.atom_slug
    JOIN library_doc d ON d.id = a1.doc_id
    WHERE d.status = 'PUBLISHED' AND d.subject_slug = ${sampleDoc.subjectSlug}
    GROUP BY a1.atom_slug, a2.atom_slug
    HAVING COUNT(DISTINCT a1.doc_id) >= 2
    ORDER BY weight DESC
    LIMIT 3
  `);
  const edges = coOccur as unknown as Array<{ slug1: string; slug2: string; weight: number }>;
  console.log(`   Top 3 co-occurrence edges:`);
  for (const e of edges) {
    console.log(`     ${e.slug1} ↔ ${e.slug2} (weight ${e.weight})`);
  }

  // ── 4. Tutor Endorsement ─────────────────────────────────────────
  console.log('\n✅ 4) Tutor Endorsement');
  if (!sampleTutor) {
    console.log('   ⚠ Không có verified tutor — skip');
  } else {
    const [existing] = await db
      .select({ id: libraryDocEndorsement.id })
      .from(libraryDocEndorsement)
      .where(eq(libraryDocEndorsement.docId, sampleDoc.id))
      .limit(1);

    if (existing) {
      console.log(`   ✓ Endorsement đã có cho doc này`);
    } else {
      const endorseId = randomUUID();
      await db.insert(libraryDocEndorsement).values({
        id: endorseId,
        docId: sampleDoc.id,
        tutorId: sampleTutor.id,
        note: 'Smoke test — doc chất lượng để học',
      });
      console.log(`   ✓ Seeded 1 endorsement từ ${sampleTutor.name}`);
    }

    // Trigger quality recompute → badge check
    const q = await recomputeQualityForDoc(sampleDoc.id);
    console.log(`   Quality after endorse: ${q.score}/100`);
    console.log(`   Badges: ${q.badges.length ? q.badges.join(', ') : '(none)'}`);
    console.log(
      `   Educator approved badge: ${q.badges.includes('educator_approved') ? '✓ GRANTED' : '✗ MISSING'}`,
    );
  }

  // ── 5. Bonus #9 Podcast script ──────────────────────────────────
  console.log('\n✅ 5) Bonus #9 — Podcast Script');
  try {
    const SYS = `Bạn là script writer podcast học tập 2 người dẫn (Host A nữ + Host B nam).
Output STRICT JSON:
{ "turns": [{"speaker": "A", "text": "..."}, {"speaker": "B", "text": "..."}] }
8-12 turns. KHÔNG markdown.`;
    const { text, costUsd } = await routedGenerateText({
      useCase: 'classify',
      userId: sampleDoc.uploaderId,
      plan: 'FREE',
      system: SYS,
      messages: [
        {
          role: 'user',
          content: `Viết script podcast về "${sampleDoc.title}" môn ${sampleDoc.subjectSlug}.`,
        },
      ],
      maxOutputTokens: 1500,
      feature: 'smoke-test',
    });
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned) as { turns: Array<{ speaker: string; text: string }> };
    console.log(`   ✓ Script generated: ${parsed.turns.length} turns, cost $${costUsd.toFixed(4)}`);
    console.log(`   First turn (${parsed.turns[0]?.speaker}): "${parsed.turns[0]?.text.slice(0, 80)}..."`);
  } catch (err) {
    console.log(`   ✗ ${(err as Error).message}`);
  }

  // ── 6. Bonus #8 Annotation ───────────────────────────────────────
  console.log('\n✅ 6) Bonus #8 — Annotation + Vote');
  const [existingAnn] = await db
    .select({ id: libraryDocAnnotation.id })
    .from(libraryDocAnnotation)
    .where(eq(libraryDocAnnotation.docId, sampleDoc.id))
    .limit(1);
  let annotationId: string;
  if (existingAnn) {
    annotationId = existingAnn.id;
    console.log(`   ✓ Annotation đã có`);
  } else {
    annotationId = randomUUID();
    await db.insert(libraryDocAnnotation).values({
      id: annotationId,
      docId: sampleDoc.id,
      authorId: sampleDoc.uploaderId, // self-annotate cho test
      pageNum: 1,
      note: 'Smoke test — trang 1 cover công thức cơ bản, nên đọc kỹ.',
      visibility: 'public',
    });
    console.log(`   ✓ Seeded 1 annotation trang 1`);
  }

  // Seed vote
  const [voteEx] = await db
    .select({ id: libraryDocAnnotationVote.id })
    .from(libraryDocAnnotationVote)
    .where(eq(libraryDocAnnotationVote.annotationId, annotationId))
    .limit(1);
  if (!voteEx) {
    await db.insert(libraryDocAnnotationVote).values({
      id: randomUUID(),
      annotationId,
      userId: sampleDoc.uploaderId,
    });
    await db
      .update(libraryDocAnnotation)
      .set({ helpfulCount: sql`${libraryDocAnnotation.helpfulCount} + 1` })
      .where(eq(libraryDocAnnotation.id, annotationId));
    console.log(`   ✓ Seeded 1 helpful vote`);
  }

  // ── 7. Bonus #12 Remix + Karma ──────────────────────────────────
  console.log('\n✅ 7) Bonus #12 — Remix + Karma');
  // Pick 2 sources cùng subject
  const sources = await db
    .select({
      id: libraryDoc.id,
      title: libraryDoc.title,
      uploaderId: libraryDoc.uploaderId,
      pageCount: libraryDoc.pageCount,
    })
    .from(libraryDoc)
    .where(eq(libraryDoc.status, 'PUBLISHED'))
    .limit(2);
  if (sources.length < 2) {
    console.log('   ⚠ Cần ≥ 2 doc PUBLISHED để remix — skip');
  } else {
    // Check existing remix với hash giống
    const [existingRemix] = await db
      .select({ id: libraryDoc.id, title: libraryDoc.title })
      .from(libraryDoc)
      .where(sql`${libraryDoc.parentRemixDocIds} && ${sql.raw(`'{${sources.map((s) => `"${s.id}"`).join(',')}}'`)}::text[]`)
      .limit(1);

    if (existingRemix) {
      console.log(`   ✓ Remix doc đã có: "${existingRemix.title}"`);
    } else {
      const remixId = randomUUID();
      const fileHash = `remix-smoke-${remixId.slice(0, 8)}`;
      await db.insert(libraryDoc).values({
        id: remixId,
        uploaderId: sources[0]!.uploaderId,
        title: `Smoke test remix: ${sources.map((s) => s.title).join(' + ').slice(0, 100)}`,
        description: 'Smoke test remix combining 2 sources',
        subjectSlug: sampleDoc.subjectSlug,
        level: 'HIGH_SCHOOL',
        docType: 'summary',
        fileFormat: 'pdf',
        fileSizeBytes: 0,
        fileUrl: `remix://${remixId}`,
        fileHash,
        pageCount: sources.reduce((s, d) => s + (d.pageCount ?? 1), 0),
        parentRemixDocIds: sources.map((s) => s.id),
        status: 'PUBLISHED',
        license: 'CC-BY-4.0',
      });

      // Bump remix_count trên sources
      await db
        .update(libraryDoc)
        .set({ remixCount: sql`${libraryDoc.remixCount} + 1` })
        .where(sql`${libraryDoc.id} = ANY(${sql.raw(`'{${sources.map((s) => `"${s.id}"`).join(',')}}'`)}::text[])`);

      console.log(`   ✓ Created remix doc with ${sources.length} sources`);

      // Award karma cho source uploaders
      for (const s of sources) {
        const r = await awardKarma({
          userId: s.uploaderId,
          eventType: 'doc_remixed',
          docId: remixId,
        });
        console.log(`     +${r.points} karma → ${s.uploaderId.slice(0, 8)}... (total ${r.total})`);
      }
    }
  }

  // Final karma state
  console.log('\n   Karma leaderboard top 5:');
  const lb = await db
    .select({
      userId: libraryCreatorKarma.userId,
      points: libraryCreatorKarma.points,
      name: userTable.name,
    })
    .from(libraryCreatorKarma)
    .leftJoin(userTable, eq(userTable.id, libraryCreatorKarma.userId))
    .orderBy(desc(libraryCreatorKarma.points))
    .limit(5);
  for (const k of lb) {
    console.log(`     ${k.points} pts — ${k.name ?? k.userId.slice(0, 8)}`);
  }

  // ── Stats summary ────────────────────────────────────────────────
  console.log('\n' + HR);
  console.log('📊 PHASE 3 STATE');
  console.log(HR);

  const stats = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM library_doc WHERE difficulty IS NOT NULL) AS docs_with_difficulty,
      (SELECT COUNT(*) FROM library_doc WHERE array_length(prerequisite_atom_slugs, 1) > 0) AS docs_with_prereq,
      (SELECT COUNT(*) FROM library_doc_endorsement) AS total_endorsements,
      (SELECT COUNT(*) FROM library_doc_annotation) AS total_annotations,
      (SELECT COUNT(*) FROM library_doc_annotation_vote) AS total_votes,
      (SELECT COUNT(*) FROM library_doc WHERE array_length(parent_remix_doc_ids, 1) > 0) AS remix_docs,
      (SELECT COUNT(*) FROM library_creator_karma) AS karma_users,
      (SELECT COUNT(*) FROM library_karma_event) AS karma_events,
      (SELECT SUM(points) FROM library_creator_karma) AS total_karma_points
  `);
  console.log(stats);

  console.log('\n🎉 Phase 3 smoke test xong.');
  console.log('   Test UI: pnpm dev → http://localhost:3001/library\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
