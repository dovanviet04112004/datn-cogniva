import { createHash, randomUUID } from 'node:crypto';
import { HttpException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { PrismaService } from '../../../infra/database/prisma.service';
import { AtomExtractorService } from './atom-extractor.service';
import { KarmaService } from './karma.service';
import { LibraryLlmService } from '../shared/llm.service';
import { QualityScoreService } from './quality-score.service';

const ENDORSE_BODY = z.object({
  note: z.string().max(500).optional(),
});

const REMIX_BODY = z.object({
  title: z.string().min(5).max(200),
  description: z.string().max(2000).optional(),
  subjectSlug: z.string().min(1),
  level: z.enum(['PRIMARY', 'SECONDARY', 'HIGH_SCHOOL', 'UNIVERSITY', 'ADULT']),
  grade: z.number().int().min(1).max(12).optional(),
  sourceDocIds: z.array(z.string().min(1)).min(2).max(5),
});

const TRANSLATE_BODY = z.object({
  target: z.enum(['vi', 'en']),
  text: z.string().min(2).max(2000),
});

const MASTERY_MATCH_THRESHOLD = 0.78;
const MASTERED_SCORE_THRESHOLD = 0.7;

const ScriptSchema = z.object({
  turns: z
    .array(
      z.object({
        speaker: z.enum(['A', 'B']),
        text: z.string().min(5).max(800),
      }),
    )
    .min(6)
    .max(30),
});

const PODCAST_SYSTEM = `Bạn là script writer cho podcast học tập 2 người dẫn (Host A + Host B), phong cách NotebookLM.

Yêu cầu:
- Host A (Linh - nữ): host chính dẫn dắt, đặt câu hỏi, ngắn gọn
- Host B (Minh - nam): expert giải thích, ví dụ cụ thể
- 12-20 turns hội thoại tự nhiên
- Mỗi turn 30-150 từ tiếng Việt
- Bắt đầu bằng intro 1-2 turn về chủ đề doc
- Kết bằng outro 1 turn rủ người nghe import doc về workspace học

Output STRICT JSON:
{
  "turns": [
    { "speaker": "A", "text": "..." },
    { "speaker": "B", "text": "..." }
  ]
}

KHÔNG markdown, KHÔNG bình luận, CHỈ JSON.`;

@Injectable()
export class LibraryEnrichService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LibraryLlmService,
    private readonly atomExtractor: AtomExtractorService,
    private readonly quality: QualityScoreService,
    private readonly karma: KarmaService,
  ) {}

  async listEndorsements(docId: string, viewerUserId: string | null) {
    const endorsements = await this.prisma.library_doc_endorsement.findMany({
      where: { doc_id: docId },
      orderBy: { created_at: 'desc' },
      take: 20,
      include: { tutor_profile: { include: { user: { select: { name: true } } } } },
    });

    const rows = endorsements.map((e) => ({
      id: e.id,
      note: e.note,
      createdAt: e.created_at,
      tutorId: e.tutor_profile.id,
      tutorHeadline: e.tutor_profile.headline,
      tutorAvatar: e.tutor_profile.avatar_url,
      tutorUserId: e.tutor_profile.user_id,
      tutorName: e.tutor_profile.user?.name ?? null,
      verificationStatus: e.tutor_profile.verification_status,
    }));

    let viewer = {
      isTutor: false,
      isVerified: false,
      isPublished: false,
      hasEndorsed: false,
    };
    if (viewerUserId) {
      const t = await this.prisma.tutor_profile.findUnique({
        where: { user_id: viewerUserId },
        select: { id: true, verification_status: true, status: true },
      });
      if (t) {
        viewer = {
          isTutor: true,
          isVerified: t.verification_status === 'KYC_VERIFIED',
          isPublished: t.status === 'PUBLISHED',
          hasEndorsed: rows.some((r) => r.tutorId === t.id),
        };
      }
    }

    return { endorsements: rows, total: rows.length, viewer };
  }

  async endorse(userId: string, docId: string, raw: unknown) {
    const tutor = await this.prisma.tutor_profile.findUnique({
      where: { user_id: userId },
      select: { id: true, verification_status: true, status: true },
    });
    if (!tutor) {
      throw new HttpException(
        { error: 'Chỉ tutor mới có thể endorse — đăng ký profile tại /tutoring/me' },
        403,
      );
    }
    if (tutor.verification_status !== 'KYC_VERIFIED') {
      throw new HttpException(
        { error: 'Cần verify KYC trước khi endorse — hoàn tất KYC tại /tutoring/me' },
        403,
      );
    }
    if (tutor.status !== 'PUBLISHED') {
      throw new HttpException({ error: 'Profile tutor đang DRAFT/PAUSED — publish trước' }, 403);
    }

    const doc = await this.prisma.library_doc.findUnique({
      where: { id: docId },
      select: { id: true, status: true },
    });
    if (!doc) throw new HttpException({ error: 'Not found' }, 404);
    if (doc.status !== 'PUBLISHED') {
      throw new HttpException({ error: 'Doc chưa PUBLISHED' }, 409);
    }

    const parsed = ENDORSE_BODY.safeParse(raw ?? {});
    if (!parsed.success) {
      throw new HttpException({ error: 'Invalid body' }, 400);
    }

    try {
      await this.prisma.library_doc_endorsement.create({
        data: {
          id: randomUUID(),
          doc_id: docId,
          tutor_id: tutor.id,
          note: parsed.data.note ?? null,
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new HttpException({ error: 'Bạn đã endorse doc này rồi' }, 409);
      }
      throw err;
    }

    void this.quality.recomputeQualityForDoc(docId).catch((err) => {
      console.error('[endorse.recompute-quality]', err);
    });

    void (async () => {
      const d = await this.prisma.library_doc.findUnique({
        where: { id: docId },
        select: { uploader_id: true },
      });
      if (d) {
        await this.karma
          .awardKarma({
            userId: d.uploader_id,
            eventType: 'endorsed',
            docId,
            context: { tutorId: tutor.id },
          })
          .catch((err) => console.error('[karma.endorsed]', err));
      }
    })();

    return { ok: true, message: 'Đã endorse — cảm ơn tutor!' };
  }

  async revokeEndorsement(userId: string, docId: string) {
    const tutor = await this.prisma.tutor_profile.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (!tutor) throw new HttpException({ error: 'Forbidden' }, 403);

    const result = await this.prisma.library_doc_endorsement.deleteMany({
      where: { doc_id: docId, tutor_id: tutor.id },
    });
    if (result.count === 0) {
      throw new HttpException({ error: 'Chưa endorse' }, 404);
    }

    void this.quality.recomputeQualityForDoc(docId).catch(() => {});
    return { ok: true };
  }

  async remix(userId: string, raw: unknown) {
    const parsed = REMIX_BODY.safeParse(raw);
    if (!parsed.success) {
      throw new HttpException({ error: 'Invalid body', details: parsed.error.flatten() }, 400);
    }
    const { title, description, subjectSlug, level, grade, sourceDocIds } = parsed.data;

    const uniqIds = Array.from(new Set(sourceDocIds));
    if (uniqIds.length < 2) {
      throw new HttpException({ error: 'Cần tối thiểu 2 doc khác nhau' }, 400);
    }

    const sources = await this.prisma.library_doc.findMany({
      where: { id: { in: uniqIds } },
      select: { id: true, uploader_id: true, title: true, page_count: true, status: true },
    });
    if (sources.length !== uniqIds.length) {
      throw new HttpException({ error: 'Một số doc nguồn không tồn tại' }, 400);
    }
    for (const s of sources) {
      if (s.status !== 'PUBLISHED') {
        throw new HttpException({ error: `Doc nguồn "${s.title}" chưa PUBLISHED` }, 400);
      }
    }

    const newDocId = randomUUID();
    const sortedHash = createHash('sha256')
      .update(uniqIds.sort().join('|'))
      .digest('hex')
      .slice(0, 32);
    const fileHash = `remix-${sortedHash}`;

    const totalPages = Math.min(
      200,
      sources.reduce((s, d) => s + (d.page_count ?? 1), 0),
    );

    await this.prisma.$transaction(
      async (tx) => {
        await tx.library_doc.create({
          data: {
            id: newDocId,
            uploader_id: userId,
            title,
            description:
              description ?? `Tổng hợp từ ${sources.length} doc nguồn về ${subjectSlug}.`,
            subject_slug: subjectSlug,
            level,
            grade: grade ?? null,
            doc_type: 'summary',
            file_format: 'pdf',
            file_size_bytes: 0,
            file_url: `remix://${newDocId}`,
            file_hash: fileHash,
            page_count: totalPages,
            preview_text: `Tổng hợp từ: ${sources.map((s) => s.title).join(' · ')}`,
            ai_summary: `Tài liệu tổng hợp từ ${sources.length} nguồn: ${sources.map((s) => s.title).join(', ')}.`,
            ai_summary_at: new Date(),
            parent_remix_doc_ids: uniqIds,
            license: 'CC-BY-4.0',
            status: 'PUBLISHED',
          },
        });

        const sourceListLiteral = `{${uniqIds.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(',')}}`;
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO library_doc_chunk
            (id, doc_id, page_num, chunk_index, content, content_vec)
          SELECT
            gen_random_uuid()::text,
            ${newDocId},
            page_num,
            chunk_index,
            content,
            content_vec
          FROM library_doc_chunk
          WHERE doc_id = ANY(${sourceListLiteral}::text[])
          ORDER BY doc_id, page_num, chunk_index
          LIMIT 200
        `);

        await tx.library_doc.updateMany({
          where: { id: { in: uniqIds } },
          data: { remix_count: { increment: 1 } },
        });
      },
      { timeout: 60_000 },
    );

    void (async () => {
      const dedupUploaders = Array.from(new Set(sources.map((s) => s.uploader_id)));
      for (const uid of dedupUploaders) {
        if (uid === userId) continue;
        await this.karma
          .awardKarma({
            userId: uid,
            eventType: 'doc_remixed',
            docId: newDocId,
            context: { remixerId: userId },
          })
          .catch((err) => console.error('[remix.karma]', uid, err));
      }
    })();

    void (async () => {
      try {
        await this.atomExtractor.extractAtomsForDoc(newDocId).catch(() => {});
        await this.quality.recomputeQualityForDoc(newDocId).catch(() => {});
      } catch {}
    })();

    return {
      ok: true,
      docId: newDocId,
      title,
      sourceCount: sources.length,
      message: `Đã tạo "${title}" tổng hợp từ ${sources.length} doc nguồn.`,
    };
  }

  async listAtoms(docId: string, viewerUserId: string | null) {
    const atoms = await this.prisma.$queryRaw<
      Array<{
        id: string;
        atom_text: string;
        atom_slug: string;
        page_nums: number[];
        difficulty: string | null;
        embedding: string | null;
      }>
    >(Prisma.sql`
      SELECT id, atom_text, atom_slug, page_nums, difficulty, embedding::text AS embedding
      FROM library_doc_atom
      WHERE doc_id = ${docId}
    `);

    if (atoms.length === 0) {
      return { atoms: [], total: 0, masteredCount: 0 };
    }

    const masteredAtomIds = new Set<string>();
    if (viewerUserId) {
      const userMasteries = await this.prisma.$queryRaw<
        Array<{ concept_id: string; score: number; embedding: string | null }>
      >(Prisma.sql`
        SELECT m.concept_id, m.score, c.embedding::text AS embedding
        FROM mastery m
        INNER JOIN concept c ON c.id = m.concept_id
        WHERE m.user_id = ${viewerUserId}
      `);
      const parsedMasteries = userMasteries.map((m) => ({
        score: m.score,
        vec: m.embedding ? (JSON.parse(m.embedding) as number[]) : null,
      }));

      for (const atom of atoms) {
        if (!atom.embedding) continue;
        const atomVec = JSON.parse(atom.embedding) as number[];
        let bestSim = 0;
        let bestScore = 0;
        for (const m of parsedMasteries) {
          if (!m.vec) continue;
          const sim = cosineSim(atomVec, m.vec);
          if (sim > bestSim) {
            bestSim = sim;
            bestScore = m.score;
          }
        }
        if (bestSim >= MASTERY_MATCH_THRESHOLD && bestScore >= MASTERED_SCORE_THRESHOLD) {
          masteredAtomIds.add(atom.id);
        }
      }
    }

    const responseAtoms = atoms.map((a) => ({
      id: a.id,
      atomText: a.atom_text,
      atomSlug: a.atom_slug,
      pageNums: a.page_nums,
      difficulty: a.difficulty,
      mastered: masteredAtomIds.has(a.id),
    }));

    return {
      atoms: responseAtoms,
      total: atoms.length,
      masteredCount: masteredAtomIds.size,
    };
  }

  async extractAtoms(userId: string, docId: string) {
    const doc = await this.prisma.library_doc.findUnique({
      where: { id: docId },
      select: { uploader_id: true, status: true, page_count: true },
    });
    if (!doc) throw new HttpException({ error: 'Not found' }, 404);
    if (doc.uploader_id !== userId) {
      throw new HttpException({ error: 'Forbidden' }, 403);
    }
    if (doc.status !== 'PUBLISHED') {
      throw new HttpException({ error: 'Doc chưa PUBLISHED, đợi ingest xong' }, 409);
    }

    try {
      const result = await this.atomExtractor.extractAtomsForDoc(docId);
      return { ok: true, ...result };
    } catch (err) {
      console.error('[atoms POST]', err);
      throw new HttpException({ error: (err as Error).message }, 500);
    }
  }

  async translate(userId: string, docId: string, raw: unknown) {
    const parsed = TRANSLATE_BODY.safeParse(raw);
    if (!parsed.success) {
      throw new HttpException({ error: 'Invalid body', details: parsed.error.flatten() }, 400);
    }

    const doc = await this.prisma.library_doc.findUnique({
      where: { id: docId },
      select: { id: true, language: true, status: true },
    });
    if (!doc) throw new HttpException({ error: 'Not found' }, 404);
    if (doc.status !== 'PUBLISHED') {
      throw new HttpException({ error: 'Not available' }, 403);
    }

    const sourceLang = doc.language ?? 'vi';
    if (sourceLang === parsed.data.target) {
      return { translated: parsed.data.text, sourceLang, noop: true };
    }

    const targetName = parsed.data.target === 'vi' ? 'tiếng Việt' : 'English';

    const { text } = await this.llm.complete({
      userId,
      plan: 'FREE',
      system: `Bạn là dịch giả chuyên nghiệp. Dịch chính xác sang ${targetName}.
Yêu cầu:
- Giữ nguyên ý nghĩa + thuật ngữ chuyên ngành (toán, lý, lập trình, ngôn ngữ)
- Văn phong tự nhiên, phù hợp tài liệu học tập
- KHÔNG thêm bình luận, KHÔNG markdown, CHỈ trả text đã dịch
- KHÔNG quote text gốc, KHÔNG ghi "đây là bản dịch"`,
      prompt: parsed.data.text,
      maxTokens: 800,
      feature: 'library.translate',
    });

    return { translated: text.trim(), sourceLang, target: parsed.data.target };
  }

  async podcastScript(docId: string) {
    const doc = await this.prisma.library_doc.findUnique({
      where: { id: docId },
      select: {
        id: true,
        uploader_id: true,
        title: true,
        subject_slug: true,
        ai_summary: true,
        preview_text: true,
        status: true,
      },
    });
    if (!doc) throw new HttpException({ error: 'Not found' }, 404);
    if (doc.status !== 'PUBLISHED') {
      throw new HttpException({ error: 'Not available' }, 403);
    }

    const atoms = await this.prisma.library_doc_atom.findMany({
      where: { doc_id: docId },
      select: { atom_text: true, difficulty: true },
      take: 8,
    });
    const chunks = await this.prisma.library_doc_chunk.findMany({
      where: { doc_id: docId },
      select: { content: true },
      orderBy: [{ page_num: 'asc' }, { chunk_index: 'asc' }],
      take: 3,
    });

    const atomList =
      atoms.length > 0
        ? atoms.map((a) => `- ${a.atom_text}${a.difficulty ? ` (${a.difficulty})` : ''}`).join('\n')
        : '(chưa có atom)';
    const chunkText = chunks
      .map((c) => c.content)
      .join('\n\n')
      .slice(0, 2000);

    const userMsg = `Tài liệu: "${doc.title}"
Môn: ${doc.subject_slug}

AI tóm tắt:
${doc.ai_summary ?? '(không có)'}

Atoms chính:
${atomList}

Nội dung mẫu (đoạn đầu):
${chunkText}

Viết script podcast 2 người dẫn về tài liệu này.`;

    const { text, costUsd } = await this.llm.complete({
      userId: doc.uploader_id,
      plan: 'FREE',
      system: PODCAST_SYSTEM,
      prompt: userMsg,
      maxTokens: 2500,
      feature: 'library.podcast.script',
    });

    const jsonText = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    let parsed: z.infer<typeof ScriptSchema>;
    try {
      parsed = ScriptSchema.parse(JSON.parse(jsonText));
    } catch (err) {
      throw new HttpException({ error: `Script parse fail: ${(err as Error).message}` }, 500);
    }

    return {
      title: doc.title,
      turns: parsed.turns,
      estimatedDurationSec: Math.round(parsed.turns.reduce((s, t) => s + t.text.length / 15, 0)),
      costUsd,
    };
  }
}

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
