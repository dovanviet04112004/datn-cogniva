import { randomUUID } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { db, libraryCourse, libraryDoc, libraryUniversity, user as userTable } from '@cogniva/db';

import { putR2Object, getPublicUrl } from '../src/lib/r2-client';
import { renderDocPdf, plainText, makeThumbnail } from './lib/pdf-render';
import { fetchArticle, fetchCategoryMembers, articleToBlocks, articlePlain } from './lib/wiki';
import { WIKI_SOURCES, type WikiSource } from './fixtures/wiki-sources';

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? parseInt(process.argv[i + 1]!, 10) : def;
}

const LIMIT = arg('limit', 50);
const PER_SOURCE = arg('per-source', 40);
const CAT_LIMIT = arg('cat-limit', 60);

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function recomputeCounts(): Promise<void> {
  await db.execute(
    sql`UPDATE library_course c SET doc_count = (SELECT COUNT(*) FROM library_doc d WHERE d.course_id = c.id AND d.status='PUBLISHED')`,
  );
  await db.execute(
    sql`UPDATE library_university u SET doc_count = (SELECT COUNT(*) FROM library_doc d WHERE d.university_id = u.id AND d.status='PUBLISHED')`,
  );
}

async function ensureUniversity(u: NonNullable<WikiSource['university']>): Promise<string> {
  const [ex] = await db
    .select({ id: libraryUniversity.id })
    .from(libraryUniversity)
    .where(eq(libraryUniversity.slug, u.slug))
    .limit(1);
  if (ex) return ex.id;
  const [created] = await db
    .insert(libraryUniversity)
    .values({ id: randomUUID(), slug: u.slug, name: u.name, shortName: u.shortName })
    .returning({ id: libraryUniversity.id });
  return created!.id;
}

async function ensureCourse(
  src: WikiSource,
  universityId: string | null,
  uploaderId: string,
): Promise<{ id: string; nameCache: string }> {
  const courseSlug = slugify(src.course.name);
  const [ex] = await db
    .select({ id: libraryCourse.id })
    .from(libraryCourse)
    .where(
      and(
        universityId
          ? eq(libraryCourse.universityId, universityId)
          : isNull(libraryCourse.universityId),
        eq(libraryCourse.slug, courseSlug),
      ),
    )
    .limit(1);
  const nameCache = src.course.code ? `${src.course.code} ${src.course.name}` : src.course.name;
  if (ex) return { id: ex.id, nameCache };
  const [c] = await db
    .insert(libraryCourse)
    .values({
      id: randomUUID(),
      universityId,
      code: src.course.code ?? null,
      name: src.course.name,
      slug: courseSlug,
      subjectArea: src.subjectArea,
      createdBy: uploaderId,
    })
    .returning({ id: libraryCourse.id });
  return { id: c!.id, nameCache };
}

async function main() {
  const [seedUser] = await db.select({ id: userTable.id }).from(userTable).limit(1);
  if (!seedUser) throw new Error('Không có user để gán uploader');
  const uploaderId = seedUser.id;

  console.log(
    `📚 Bulk seed từ Wikipedia VN — limit ${LIMIT}, per-source ${PER_SOURCE}, cat-limit ${CAT_LIMIT}\n`,
  );
  let created = 0,
    skipped = 0,
    failed = 0;

  for (const src of WIKI_SOURCES) {
    if (created >= LIMIT) break;
    const label = src.university
      ? `${src.university.shortName}/${src.course.name}`
      : src.course.name;

    const titles = new Set<string>(src.seeds ?? []);
    for (const cat of src.categories ?? []) {
      try {
        for (const t of await fetchCategoryMembers(cat, CAT_LIMIT)) titles.add(t);
      } catch {}
    }
    const titleList = [...titles].slice(0, PER_SOURCE);
    console.log(`\n── ${label} — ${titleList.length} topic ──`);

    const universityId = src.university ? await ensureUniversity(src.university) : null;
    const { id: courseId, nameCache } = await ensureCourse(src, universityId, uploaderId);
    const uniNameCache = src.university
      ? `${src.university.shortName} ${src.university.name}`.trim()
      : null;

    for (const title of titleList) {
      if (created >= LIMIT) break;

      const [exist] = await db
        .select({ id: libraryDoc.id })
        .from(libraryDoc)
        .where(eq(libraryDoc.title, title))
        .limit(1);
      if (exist) {
        skipped++;
        continue;
      }

      try {
        const art = await fetchArticle(title);
        if (!art) {
          skipped++;
          continue;
        }
        await sleep(80);

        const blocks = articleToBlocks(art);
        const docId = randomUUID();
        const pdfBuffer = await renderDocPdf(art.title, nameCache, blocks);
        const key = `lib/${uploaderId}/${docId}.pdf`;
        await putR2Object(key, pdfBuffer, 'application/pdf');
        const fileUrl = getPublicUrl(key);

        const { PDFDocument } = await import('pdf-lib');
        const pageCount = (await PDFDocument.load(pdfBuffer)).getPageCount();

        let thumbUrl: string | null = null;
        const thumb = await makeThumbnail(pdfBuffer);
        if (thumb) {
          const tkey = `lib/${uploaderId}/${docId}-thumb.jpg`;
          await putR2Object(tkey, thumb, 'image/jpeg');
          thumbUrl = getPublicUrl(tkey);
        }

        await db.insert(libraryDoc).values({
          id: docId,
          uploaderId,
          title: art.title,
          description: articlePlain(art).slice(0, 300),
          subjectSlug: src.subjectArea,
          courseId,
          universityId,
          courseNameCache: nameCache,
          universityNameCache: uniNameCache,
          level: src.level,
          grade: src.grade ?? null,
          docType: src.docType,
          region: 'national',
          language: 'vi',
          tags: [src.course.name.toLowerCase(), src.subjectArea],
          fileFormat: 'pdf',
          fileSizeBytes: pdfBuffer.length,
          fileUrl,
          fileHash: `wiki-${docId}`,
          pageCount,
          previewThumbUrl: thumbUrl,
          previewText: plainText(blocks).slice(0, 3000),
          license: 'CC-BY-4.0',
          status: 'PUBLISHED',
          ratingAvg: null,
          ratingCount: 0,
          viewCount: 0,
          downloadCount: 0,
          workspaceImportCount: 0,
          qualityScore: null,
          badges: [],
        });

        created++;
        if (created % 10 === 0) console.log(`   … ${created} doc`);
        if (created % 50 === 0) await recomputeCounts();
      } catch (err) {
        failed++;
        if (failed <= 5)
          console.log(`   ✗ ${title.slice(0, 40)}: ${(err as Error).message.slice(0, 80)}`);
      }
    }
  }

  await recomputeCounts();

  console.log(`\n────────────\nCreated: ${created} · Skipped: ${skipped} · Failed: ${failed}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
