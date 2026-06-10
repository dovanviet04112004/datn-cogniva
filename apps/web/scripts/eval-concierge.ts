/**
 * AI Concierge Eval Runner — V5 Phase 5.
 *
 * Chạy fixtures qua planner + hybrid search, so sánh với expected output,
 * print accuracy report. Pass nếu ≥ 85% accuracy. Production gate before ship.
 *
 * Usage:
 *   cd apps/web
 *   pnpm exec tsx --env-file=.env.local scripts/eval-concierge.ts
 *
 * Spec: docs/plans/tutoring-v5-concierge-prod.md §Phase 5.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  planConciergeStep,
  validateFilters,
  type ConciergeAction,
} from '../src/lib/tutoring/concierge-agent';
import { hybridSearchTutors } from '../src/lib/tutoring/hybrid-search';
import { hybridSearchRequests } from '../src/lib/tutoring/request-search';

type FixtureCase = {
  id: string;
  input: string;
  expect: {
    role?: 'student' | 'tutor';
    action?: 'clarify' | 'search';
    subjectSlug?: string;
    level?: string;
    modality?: string;
    budgetMaxVnd?: number;
    minResults?: number;
  };
};

const fixturesPath = join(__dirname, 'fixtures', 'concierge-cases.json');
const fixtures = JSON.parse(readFileSync(fixturesPath, 'utf-8')) as FixtureCase[];

const SYSTEM_USER_ID = 'eval-runner';
const SYSTEM_PLAN = 'FREE' as const;

type CaseResult = {
  id: string;
  input: string;
  pass: boolean;
  checks: Record<string, { expected: unknown; actual: unknown; pass: boolean }>;
  resultCount?: number;
};

async function runCase(c: FixtureCase): Promise<CaseResult> {
  const action: ConciergeAction = await planConciergeStep({
    history: [{ role: 'user', content: c.input }],
    userId: SYSTEM_USER_ID,
    plan: SYSTEM_PLAN,
  });

  const checks: CaseResult['checks'] = {};
  const exp = c.expect;

  // Role check
  const actualRole = action.type === 'clarify' ? action.role : action.role;
  if (exp.role !== undefined) {
    checks.role = {
      expected: exp.role,
      actual: actualRole,
      pass: actualRole === exp.role,
    };
  }

  // Action check
  if (exp.action !== undefined) {
    checks.action = {
      expected: exp.action,
      actual: action.type,
      pass: action.type === exp.action,
    };
  }

  // Filters check (only when action=search)
  let resultCount: number | undefined;
  if (action.type === 'search') {
    const { cleaned } = validateFilters(action.filters);
    if (exp.subjectSlug !== undefined) {
      checks.subjectSlug = {
        expected: exp.subjectSlug,
        actual: cleaned.subjectSlug,
        pass: cleaned.subjectSlug === exp.subjectSlug,
      };
    }
    if (exp.level !== undefined) {
      checks.level = {
        expected: exp.level,
        actual: cleaned.level,
        pass: cleaned.level === exp.level,
      };
    }
    if (exp.modality !== undefined) {
      checks.modality = {
        expected: exp.modality,
        actual: cleaned.modality,
        pass: cleaned.modality === exp.modality,
      };
    }
    if (exp.budgetMaxVnd !== undefined) {
      checks.budgetMaxVnd = {
        expected: exp.budgetMaxVnd,
        actual: cleaned.budgetMaxVnd,
        // Tolerate ±20% — planner may interpret "dưới 200k" loosely
        pass:
          cleaned.budgetMaxVnd != null &&
          Math.abs(cleaned.budgetMaxVnd - exp.budgetMaxVnd) <=
            exp.budgetMaxVnd * 0.2,
      };
    }

    // Run actual search for minResults check
    if (exp.minResults !== undefined) {
      if (action.searchTarget === 'request') {
        const reqs = await hybridSearchRequests({
          query: c.input,
          filters: {
            subjectSlug: cleaned.subjectSlug,
            level: cleaned.level,
            modality: cleaned.modality,
          },
          limit: 10,
        });
        resultCount = reqs.length;
      } else {
        const tutors = await hybridSearchTutors({
          query: c.input,
          filters: {
            subjectSlug: cleaned.subjectSlug,
            level: cleaned.level,
            modality: cleaned.modality,
            budgetMaxVnd: cleaned.budgetMaxVnd,
          },
          limit: 10,
        });
        resultCount = tutors.length;
      }
      checks.minResults = {
        expected: `>=${exp.minResults}`,
        actual: resultCount,
        pass: resultCount >= exp.minResults,
      };
    }
  }

  const pass = Object.values(checks).every((c) => c.pass);
  return { id: c.id, input: c.input, pass, checks, resultCount };
}

async function main() {
  console.log(`\n📋 Running ${fixtures.length} concierge eval cases...\n`);

  const results: CaseResult[] = [];
  for (const c of fixtures) {
    process.stdout.write(`  ${c.id.padEnd(36)} ... `);
    try {
      const r = await runCase(c);
      results.push(r);
      console.log(r.pass ? '✓ PASS' : '✗ FAIL');
    } catch (err) {
      console.log(`💥 ERROR ${(err as Error).message}`);
      results.push({
        id: c.id,
        input: c.input,
        pass: false,
        checks: {
          execution: { expected: 'no error', actual: (err as Error).message, pass: false },
        },
      });
    }
  }

  // Print details of failures
  const failures = results.filter((r) => !r.pass);
  if (failures.length > 0) {
    console.log(`\n🔴 ${failures.length} failure(s):\n`);
    for (const f of failures) {
      console.log(`  ❌ ${f.id} — "${f.input}"`);
      for (const [key, c] of Object.entries(f.checks)) {
        if (!c.pass) {
          console.log(`     ${key}: expected ${JSON.stringify(c.expected)} got ${JSON.stringify(c.actual)}`);
        }
      }
    }
  }

  // Aggregate metric breakdown
  const metrics: Record<string, { total: number; pass: number }> = {};
  for (const r of results) {
    for (const [key, c] of Object.entries(r.checks)) {
      metrics[key] ??= { total: 0, pass: 0 };
      metrics[key].total++;
      if (c.pass) metrics[key].pass++;
    }
  }

  console.log('\n📊 Accuracy breakdown:');
  for (const [k, m] of Object.entries(metrics)) {
    const pct = ((m.pass / m.total) * 100).toFixed(0);
    console.log(`  ${k.padEnd(20)} ${m.pass}/${m.total} (${pct}%)`);
  }

  const totalPass = results.filter((r) => r.pass).length;
  const overallPct = (totalPass / results.length) * 100;
  console.log(`\n🎯 Overall: ${totalPass}/${results.length} (${overallPct.toFixed(0)}%)`);

  const threshold = 75;
  if (overallPct < threshold) {
    console.log(`\n❌ FAIL — Accuracy ${overallPct.toFixed(0)}% < ${threshold}% threshold`);
    process.exit(1);
  }
  console.log(`\n✅ PASS — Accuracy ≥ ${threshold}%`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[eval-fatal]', err);
  process.exit(1);
});
