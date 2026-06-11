import { libraryDoc, user as userTable } from '@cogniva/db';

import type { DocCardData } from '@/components/library/doc-card';

export const docCardColumns = {
  id: libraryDoc.id,
  title: libraryDoc.title,
  description: libraryDoc.description,
  subjectSlug: libraryDoc.subjectSlug,
  level: libraryDoc.level,
  grade: libraryDoc.grade,
  docType: libraryDoc.docType,
  language: libraryDoc.language,
  tags: libraryDoc.tags,
  fileFormat: libraryDoc.fileFormat,
  pageCount: libraryDoc.pageCount,
  previewThumbUrl: libraryDoc.previewThumbUrl,
  aiSummary: libraryDoc.aiSummary,
  ratingAvg: libraryDoc.ratingAvg,
  ratingCount: libraryDoc.ratingCount,
  workspaceImportCount: libraryDoc.workspaceImportCount,
  uploaderName: userTable.name,
  badges: libraryDoc.badges,
  difficulty: libraryDoc.difficulty,
  isPremium: libraryDoc.isPremium,
  priceVnd: libraryDoc.priceVnd,
  courseNameCache: libraryDoc.courseNameCache,
  createdAt: libraryDoc.createdAt,
} as const;

type DocCardRow = {
  [K in keyof typeof docCardColumns]: unknown;
};

export function toDocCardData(r: DocCardRow): DocCardData {
  return {
    id: r.id as string,
    title: r.title as string,
    description: (r.description as string | null) ?? null,
    subjectSlug: r.subjectSlug as string,
    level: r.level as string,
    grade: (r.grade as number | null) ?? null,
    docType: r.docType as string,
    language: r.language as string,
    tags: (r.tags as string[] | null) ?? [],
    fileFormat: r.fileFormat as string,
    pageCount: (r.pageCount as number | null) ?? null,
    previewThumbUrl: (r.previewThumbUrl as string | null) ?? null,
    aiSummary: (r.aiSummary as string | null) ?? null,
    ratingAvg: r.ratingAvg != null ? Number(r.ratingAvg) : null,
    ratingCount: (r.ratingCount as number | null) ?? 0,
    workspaceImportCount: (r.workspaceImportCount as number | null) ?? 0,
    uploaderName: (r.uploaderName as string | null) ?? null,
    badges: (r.badges as string[] | null) ?? [],
    difficulty: (r.difficulty as string | null) ?? null,
    isPremium: (r.isPremium as boolean | null) ?? false,
    priceVnd: (r.priceVnd as number | null) ?? null,
    courseNameCache: (r.courseNameCache as string | null) ?? null,
    createdAt: (r.createdAt as Date).toISOString(),
  };
}
