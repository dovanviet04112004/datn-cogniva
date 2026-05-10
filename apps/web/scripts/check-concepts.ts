/** Quick check — đếm concepts + relations trong DB. */
import { sql, db } from '@cogniva/db';

(async () => {
  const counts = await db.execute<{
    concepts: number;
    relations: number;
    links: number;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM concept) AS concepts,
      (SELECT count(*)::int FROM concept_relation) AS relations,
      (SELECT count(*)::int FROM chunk_concept) AS links;
  `);
  console.log('Counts:', counts[0]);

  const sampleConcepts = await db.execute<{ name: string; domain: string }>(sql`
    SELECT name, domain FROM concept ORDER BY name LIMIT 10;
  `);
  console.log('Sample concepts:');
  sampleConcepts.forEach((c) => console.log(`  - ${c.name} [${c.domain}]`));

  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
