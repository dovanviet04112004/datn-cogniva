import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { cached, cacheVersion } from '@cogniva/server-core/cache/cache-aside';
import { ck, TAG_LIBRARY } from '@cogniva/server-core/cache/keys';

import { PrismaService } from '../../../infra/database/prisma.service';

export type DocCardData = {
  id: string;
  title: string;
  description: string | null;
  subjectSlug: string;
  level: string;
  grade: number | null;
  docType: string;
  language: string;
  tags: string[];
  fileFormat: string;
  pageCount: number | null;
  previewThumbUrl: string | null;
  aiSummary: string | null;
  ratingAvg: number | null;
  ratingCount: number;
  workspaceImportCount: number;
  uploaderName: string | null;
  badges: string[];
  difficulty: string | null;
  isPremium: boolean;
  priceVnd: number | null;
  courseNameCache: string | null;
  createdAt: string;
};

type DocCardRow = {
  id: string;
  title: string;
  description: string | null;
  subject_slug: string;
  level: string;
  grade: number | null;
  doc_type: string;
  language: string;
  tags: string[] | null;
  file_format: string;
  page_count: number | null;
  preview_thumb_url: string | null;
  ai_summary: string | null;
  rating_avg: unknown;
  rating_count: number | null;
  workspace_import_count: number | null;
  uploader_name: string | null;
  badges: string[] | null;
  difficulty: string | null;
  is_premium: boolean | null;
  price_vnd: number | null;
  course_name_cache: string | null;
  created_at: Date;
};

const DOC_CARD_COLS = Prisma.sql`tp.id, tp.title, tp.description, tp.subject_slug, tp.level,
  tp.grade, tp.doc_type, tp.language, tp.tags, tp.file_format, tp.page_count,
  tp.preview_thumb_url, tp.ai_summary, tp.rating_avg, tp.rating_count,
  tp.workspace_import_count, u.name AS uploader_name, tp.badges, tp.difficulty,
  tp.is_premium, tp.price_vnd, tp.course_name_cache, tp.created_at`;

@Injectable()
export class LibraryDiscoveryService {
  constructor(private readonly prisma: PrismaService) {}

  async getHubStats() {
    return cached(ck.libraryHubStats(), 3600, async () => {
      const rows = await this.prisma.$queryRaw<
        Array<{ total: number; total_imports: number }>
      >(Prisma.sql`
        SELECT count(id)::int AS total,
          COALESCE(SUM(workspace_import_count), 0)::int AS total_imports
        FROM library_doc
        WHERE status = 'PUBLISHED'`);
      return { total: rows[0]?.total ?? 0, totalImports: rows[0]?.total_imports ?? 0 };
    });
  }

  async getKarmaBoard() {
    return cached(ck.karmaBoard(), 300, async () => {
      const [leaderboardRows, eventRows, totalsRows] = await Promise.all([
        this.prisma.$queryRaw<
          Array<{
            user_id: string;
            points: number;
            last_event_at: Date | null;
            name: string | null;
            image: string | null;
          }>
        >(Prisma.sql`
          SELECT k.user_id, k.points, k.last_event_at, u.name, u.image
          FROM library_creator_karma k
          LEFT JOIN "user" u ON u.id = k.user_id
          ORDER BY k.points DESC
          LIMIT 20`),
        this.prisma.$queryRaw<
          Array<{
            id: string;
            user_id: string;
            event_type: string;
            points: number;
            doc_id: string | null;
            created_at: Date;
            user_name: string | null;
            user_image: string | null;
            doc_title: string | null;
          }>
        >(Prisma.sql`
          SELECT e.id, e.user_id, e.event_type, e.points, e.doc_id, e.created_at,
            u.name AS user_name, u.image AS user_image, d.title AS doc_title
          FROM library_karma_event e
          LEFT JOIN "user" u ON u.id = e.user_id
          LEFT JOIN library_doc d ON d.id = e.doc_id
          ORDER BY e.created_at DESC
          LIMIT 15`),
        this.prisma.$queryRaw<
          Array<{ event_type: string; total: number; total_points: number }>
        >(Prisma.sql`
          SELECT event_type, COUNT(*)::int AS total, SUM(points)::int AS total_points
          FROM library_karma_event
          GROUP BY event_type`),
      ]);

      return {
        leaderboard: leaderboardRows.map((r) => ({
          userId: r.user_id,
          points: r.points,
          lastEventAt: r.last_event_at ? r.last_event_at.toISOString() : null,
          name: r.name,
          image: r.image,
        })),
        recentEvents: eventRows.map((r) => ({
          id: r.id,
          userId: r.user_id,
          eventType: r.event_type,
          points: r.points,
          docId: r.doc_id,
          createdAt: r.created_at.toISOString(),
          userName: r.user_name,
          userImage: r.user_image,
          docTitle: r.doc_title,
        })),
        totalsByType: totalsRows.map((r) => ({
          eventType: r.event_type,
          total: r.total,
          totalPoints: r.total_points,
        })),
      };
    });
  }

  async getUniversitiesDirectory() {
    return cached(ck.universities(), 3600, async () => {
      const [universities, courseCounts, generalCourseRows] = await Promise.all([
        this.prisma.$queryRaw<
          Array<{ id: string; name: string; short_name: string | null; doc_count: number }>
        >(Prisma.sql`
          SELECT id, name, short_name, doc_count
          FROM library_university
          WHERE doc_count > 0 AND approved = true
          ORDER BY doc_count DESC`),
        this.prisma.$queryRaw<Array<{ university_id: string | null; n: number }>>(Prisma.sql`
          SELECT university_id, count(*)::int AS n
          FROM library_course
          WHERE doc_count > 0 AND approved = true
          GROUP BY university_id`),
        this.prisma.$queryRaw<
          Array<{ id: string; name: string; code: string | null; doc_count: number }>
        >(Prisma.sql`
          SELECT id, name, code, doc_count
          FROM library_course
          WHERE doc_count > 0 AND approved = true AND university_id IS NULL
          ORDER BY doc_count DESC`),
      ]);

      const courseCountMap = new Map(
        courseCounts
          .filter((r) => r.university_id)
          .map((r) => [r.university_id as string, Number(r.n)]),
      );

      return {
        unis: universities.map((u) => ({
          id: u.id,
          name: u.name,
          shortName: u.short_name,
          docCount: u.doc_count,
          courseCount: courseCountMap.get(u.id) ?? 0,
        })),
        generalCourses: generalCourseRows.map((c) => ({
          id: c.id,
          name: c.name,
          code: c.code,
          docCount: c.doc_count,
        })),
      };
    });
  }

  async getUniversityDetail(id: string) {
    const ver = await cacheVersion(TAG_LIBRARY);
    return cached(ck.universityDetail(id, ver), 3600, async () => {
      const uniRows = await this.prisma.$queryRaw<
        Array<{ id: string; name: string; short_name: string | null; doc_count: number }>
      >(Prisma.sql`
        SELECT id, name, short_name, doc_count
        FROM library_university
        WHERE id = ${id} AND approved = true
        LIMIT 1`);
      const uni = uniRows[0];
      if (!uni) return null;

      const [courseRows, breakdownRows] = await Promise.all([
        this.prisma.$queryRaw<
          Array<{ id: string; name: string; code: string | null; doc_count: number }>
        >(Prisma.sql`
          SELECT id, name, code, doc_count
          FROM library_course
          WHERE university_id = ${id} AND doc_count > 0 AND approved = true
          ORDER BY doc_count DESC
          LIMIT 200`),
        this.prisma.$queryRaw<Array<{ doc_type: string; n: number }>>(Prisma.sql`
          SELECT doc_type, count(*)::int AS n
          FROM library_doc
          WHERE university_id = ${id} AND status = 'PUBLISHED'
          GROUP BY doc_type
          ORDER BY count(*) DESC`),
      ]);

      return {
        uni: { id: uni.id, name: uni.name, shortName: uni.short_name, docCount: uni.doc_count },
        courses: courseRows.map((c) => ({
          id: c.id,
          name: c.name,
          code: c.code,
          docCount: c.doc_count,
        })),
        docTypeBreakdown: breakdownRows.map((r) => ({ docType: r.doc_type, n: r.n })),
      };
    });
  }

  async getCourseDetail(id: string) {
    const ver = await cacheVersion(TAG_LIBRARY);
    return cached(ck.courseDetail(id, ver), 3600, async () => {
      const rows = await this.prisma.$queryRaw<
        Array<{
          id: string;
          name: string;
          code: string | null;
          doc_count: number;
          university_id: string | null;
          university_name: string | null;
          university_short: string | null;
        }>
      >(Prisma.sql`
        SELECT c.id, c.name, c.code, c.doc_count, c.university_id,
          u.name AS university_name, u.short_name AS university_short
        FROM library_course c
        LEFT JOIN library_university u ON u.id = c.university_id
        WHERE c.id = ${id} AND c.approved = true
        LIMIT 1`);
      const course = rows[0];
      if (!course) return null;

      return {
        id: course.id,
        name: course.name,
        code: course.code,
        docCount: course.doc_count,
        universityId: course.university_id,
        universityName: course.university_name,
        universityShort: course.university_short,
      };
    });
  }

  async getRecentlyViewed(userId: string): Promise<{ docs: DocCardData[] }> {
    const rows = await this.prisma.$queryRaw<DocCardRow[]>(Prisma.sql`
      SELECT ${DOC_CARD_COLS}
      FROM library_doc_view v
      INNER JOIN library_doc tp ON tp.id = v.doc_id
      LEFT JOIN "user" u ON u.id = tp.uploader_id
      WHERE v.user_id = ${userId}
      ORDER BY v.viewed_at DESC, v.id DESC
      LIMIT 12`);
    return { docs: rows.map(toDocCard) };
  }

  async getHubSections(
    userId: string | null,
  ): Promise<{ forYou: DocCardData[]; popular: DocCardData[] }> {
    let forYou: DocCardData[] = [];

    if (userId) {
      const [viewed, imported] = await Promise.all([
        this.prisma.$queryRaw<Array<{ doc_id: string; subject_slug: string }>>(Prisma.sql`
          SELECT v.doc_id, d.subject_slug
          FROM library_doc_view v
          INNER JOIN library_doc d ON d.id = v.doc_id
          WHERE v.user_id = ${userId}
          ORDER BY v.viewed_at DESC
          LIMIT 40`),
        this.prisma.$queryRaw<Array<{ doc_id: string; subject_slug: string }>>(Prisma.sql`
          SELECT i.doc_id, d.subject_slug
          FROM library_doc_import i
          INNER JOIN library_doc d ON d.id = i.doc_id
          WHERE i.importer_id = ${userId}
          LIMIT 40`),
      ]);

      const seenIds = new Set<string>();
      const subjCount = new Map<string, number>();
      for (const r of [...viewed, ...imported]) {
        seenIds.add(r.doc_id);
        subjCount.set(r.subject_slug, (subjCount.get(r.subject_slug) ?? 0) + 1);
      }
      const topSubjects = [...subjCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([s]) => s);

      if (topSubjects.length > 0) {
        const conds = [Prisma.sql`tp.subject_slug IN (${Prisma.join(topSubjects)})`];
        if (seenIds.size > 0) {
          conds.push(Prisma.sql`tp.id NOT IN (${Prisma.join([...seenIds])})`);
        }
        forYou = await this.fetchCurated(
          Prisma.sql`tp.quality_score DESC`,
          Prisma.join(conds, ' AND '),
        );
      }
    }

    let popular: DocCardData[] = [];
    if (forYou.length === 0) {
      popular = await this.fetchCurated(
        Prisma.sql`COALESCE(tp.workspace_import_count, 0) * 2 + COALESCE(tp.view_count, 0) DESC`,
      );
    }

    return { forYou, popular };
  }

  private async fetchCurated(orderBy: Prisma.Sql, whereExtra?: Prisma.Sql): Promise<DocCardData[]> {
    const where = whereExtra
      ? Prisma.sql`tp.status = 'PUBLISHED' AND ${whereExtra}`
      : Prisma.sql`tp.status = 'PUBLISHED'`;

    const rows = await this.prisma.$queryRaw<DocCardRow[]>(Prisma.sql`
      SELECT ${DOC_CARD_COLS}
      FROM library_doc tp
      LEFT JOIN "user" u ON u.id = tp.uploader_id
      WHERE ${where}
      ORDER BY ${orderBy}, tp.id DESC
      LIMIT 12`);

    return rows.map(toDocCard);
  }
}

function toDocCard(r: DocCardRow): DocCardData {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    subjectSlug: r.subject_slug,
    level: r.level,
    grade: r.grade,
    docType: r.doc_type,
    language: r.language,
    tags: r.tags ?? [],
    fileFormat: r.file_format,
    pageCount: r.page_count,
    previewThumbUrl: r.preview_thumb_url,
    aiSummary: r.ai_summary,
    ratingAvg: r.rating_avg != null ? Number(r.rating_avg) : null,
    ratingCount: r.rating_count ?? 0,
    workspaceImportCount: r.workspace_import_count ?? 0,
    uploaderName: r.uploader_name,
    badges: r.badges ?? [],
    difficulty: r.difficulty,
    isPremium: r.is_premium ?? false,
    priceVnd: r.price_vnd,
    courseNameCache: r.course_name_cache,
    createdAt: r.created_at.toISOString(),
  };
}
