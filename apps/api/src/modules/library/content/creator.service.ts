import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../infra/database/prisma.service';

type RemixDocRow = {
  id: string;
  title: string;
  subject_slug: string;
  doc_type: string;
  page_count: number | null;
  quality_score: unknown;
};

type CreatorAggRow = {
  total_imports: number;
  total_downloads: number;
  total_remixes: number;
  total_docs: number;
  avg_quality: number;
};

@Injectable()
export class LibraryCreatorService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(userId: string) {
    const docRows = await this.prisma.library_doc.findMany({
      where: { uploader_id: userId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        title: true,
        subject_slug: true,
        doc_type: true,
        status: true,
        page_count: true,
        view_count: true,
        download_count: true,
        workspace_import_count: true,
        remix_count: true,
        rating_avg: true,
        rating_count: true,
        quality_score: true,
        badges: true,
        created_at: true,
      },
    });

    const docs = docRows.map((d) => ({
      id: d.id,
      title: d.title,
      subjectSlug: d.subject_slug,
      docType: d.doc_type,
      status: d.status,
      pageCount: d.page_count,
      viewCount: d.view_count ?? 0,
      downloadCount: d.download_count ?? 0,
      workspaceImportCount: d.workspace_import_count ?? 0,
      remixCount: d.remix_count,
      ratingAvg: d.rating_avg ? Number(d.rating_avg) : null,
      ratingCount: d.rating_count ?? 0,
      qualityScore: d.quality_score ? Number(d.quality_score) : null,
      badges: d.badges,
      createdAt: d.created_at,
    }));

    const karmaRow = await this.prisma.library_creator_karma.findUnique({
      where: { user_id: userId },
      select: { points: true, last_event_at: true },
    });
    const karma = karmaRow
      ? { points: karmaRow.points, lastEventAt: karmaRow.last_event_at }
      : null;

    let rank: number | null = null;
    if (karmaRow?.points) {
      const higher = await this.prisma.library_creator_karma.count({
        where: { points: { gt: karmaRow.points } },
      });
      rank = higher + 1;
    }

    const aggRows = await this.prisma.$queryRaw<CreatorAggRow[]>(Prisma.sql`
      SELECT
        COALESCE(SUM(workspace_import_count), 0)::int AS total_imports,
        COALESCE(SUM(download_count), 0)::int AS total_downloads,
        COALESCE(SUM(remix_count), 0)::int AS total_remixes,
        COUNT(*)::int AS total_docs,
        COALESCE(AVG(quality_score), 0)::float AS avg_quality
      FROM library_doc
      WHERE uploader_id = ${userId}`);
    const aggRow = aggRows[0];
    const agg = {
      totalImports: aggRow?.total_imports ?? 0,
      totalDownloads: aggRow?.total_downloads ?? 0,
      totalRemixes: aggRow?.total_remixes ?? 0,
      totalDocs: aggRow?.total_docs ?? 0,
      avgQuality: aggRow?.avg_quality ?? 0,
    };

    const endorseTotal = await this.prisma.library_doc_endorsement.count({
      where: { library_doc: { uploader_id: userId } },
    });

    const eventRows = await this.prisma.library_karma_event.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: 10,
      select: {
        id: true,
        event_type: true,
        points: true,
        doc_id: true,
        created_at: true,
        library_doc: { select: { title: true } },
      },
    });
    const recentEvents = eventRows.map((e) => ({
      id: e.id,
      eventType: e.event_type,
      points: e.points,
      docId: e.doc_id,
      createdAt: e.created_at,
      docTitle: e.library_doc?.title ?? null,
    }));

    return { docs, karma, rank, agg, endorseTotal, recentEvents };
  }

  async getRemixAvailable(userId: string) {
    const importRows = await this.prisma.$queryRaw<RemixDocRow[]>(Prisma.sql`
      SELECT DISTINCT ON (d.id)
        d.id, d.title, d.subject_slug, d.doc_type, d.page_count, d.quality_score
      FROM library_doc_import imp
      JOIN library_doc d ON d.id = imp.doc_id
      WHERE imp.importer_id = ${userId} AND d.status = 'PUBLISHED'
      ORDER BY d.id, imp.imported_at DESC
      LIMIT 50`);

    const ownRows = await this.prisma.library_doc.findMany({
      where: { uploader_id: userId, status: 'PUBLISHED' },
      orderBy: { created_at: 'desc' },
      take: 20,
      select: {
        id: true,
        title: true,
        subject_slug: true,
        doc_type: true,
        page_count: true,
        quality_score: true,
      },
    });

    const normalized = [
      ...importRows.map((r) => ({
        id: r.id,
        title: r.title,
        subjectSlug: r.subject_slug,
        docType: r.doc_type,
        pageCount: r.page_count,
        qualityScore: r.quality_score,
      })),
      ...ownRows.map((r) => ({
        id: r.id,
        title: r.title,
        subjectSlug: r.subject_slug,
        docType: r.doc_type,
        pageCount: r.page_count,
        qualityScore: r.quality_score as unknown,
      })),
    ];

    const seen = new Set<string>();
    const available = normalized
      .filter((d) => {
        if (seen.has(d.id)) return false;
        seen.add(d.id);
        return true;
      })
      .map((d) => ({
        ...d,
        qualityScore: d.qualityScore ? Number(d.qualityScore) : null,
      }));

    return { available };
  }
}
