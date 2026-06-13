import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { db, libraryCourse, libraryUniversity } from '@cogniva/db';
import { ALL_SUBJECTS } from '@cogniva/db/taxonomy';

const UNIVERSITIES = [
  { slug: 'dai-hoc-bach-khoa-ha-noi', name: 'Đại học Bách khoa Hà Nội', shortName: 'HUST' },
  { slug: 'dai-hoc-quoc-gia-ha-noi', name: 'Đại học Quốc gia Hà Nội', shortName: 'VNU-HN' },
  { slug: 'dai-hoc-quoc-gia-tp-hcm', name: 'Đại học Quốc gia TP.HCM', shortName: 'VNU-HCM' },
  { slug: 'dai-hoc-bach-khoa-tp-hcm', name: 'Đại học Bách khoa TP.HCM', shortName: 'HCMUT' },
  { slug: 'dai-hoc-kinh-te-quoc-dan', name: 'Đại học Kinh tế Quốc dân', shortName: 'NEU' },
  { slug: 'dai-hoc-ngoai-thuong', name: 'Đại học Ngoại thương', shortName: 'FTU' },
  { slug: 'dai-hoc-fpt', name: 'Đại học FPT', shortName: 'FPTU' },
  { slug: 'dai-hoc-cong-nghe-vnu', name: 'Đại học Công nghệ — ĐHQGHN', shortName: 'UET' },
  { slug: 'dai-hoc-khoa-hoc-tu-nhien-hcm', name: 'Đại học Khoa học Tự nhiên TP.HCM', shortName: 'HCMUS' },
  { slug: 'dai-hoc-su-pham-ha-noi', name: 'Đại học Sư phạm Hà Nội', shortName: 'HNUE' },
  { slug: 'dai-hoc-y-ha-noi', name: 'Đại học Y Hà Nội', shortName: 'HMU' },
  { slug: 'hoc-vien-cong-nghe-buu-chinh-vien-thong', name: 'Học viện Công nghệ Bưu chính Viễn thông', shortName: 'PTIT' },
];

async function main() {
  let uniCreated = 0;
  for (const u of UNIVERSITIES) {
    const res = await db
      .insert(libraryUniversity)
      .values({ id: randomUUID(), slug: u.slug, name: u.name, shortName: u.shortName })
      .onConflictDoNothing({ target: libraryUniversity.slug })
      .returning({ id: libraryUniversity.id });
    if (res.length > 0) uniCreated++;
  }

  let courseCreated = 0;
  for (const s of ALL_SUBJECTS) {
    const existing = await db
      .select({ id: libraryCourse.id })
      .from(libraryCourse)
      .where(and(isNull(libraryCourse.universityId), eq(libraryCourse.slug, s.slug)))
      .limit(1);
    if (existing[0]) continue;
    await db.insert(libraryCourse).values({
      id: randomUUID(),
      universityId: null,
      name: s.name,
      slug: s.slug,
      subjectArea: s.slug,
    });
    courseCreated++;
  }

  const uniSlugs = UNIVERSITIES.map((u) => u.slug);
  const subjSlugs = ALL_SUBJECTS.map((s) => s.slug);
  await db.execute(
    sql`UPDATE library_university SET approved = true WHERE slug IN (${sql.join(
      uniSlugs.map((s) => sql`${s}`),
      sql`, `,
    )})`,
  );
  await db.execute(
    sql`UPDATE library_course SET approved = true WHERE university_id IS NULL AND slug IN (${sql.join(
      subjSlugs.map((s) => sql`${s}`),
      sql`, `,
    )})`,
  );

  console.log(
    `✓ Catalog seed xong — trường mới: ${uniCreated}/${UNIVERSITIES.length}, môn chung mới: ${courseCreated}/${ALL_SUBJECTS.length}. Tất cả đã approved=true.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
