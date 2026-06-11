const BASE_URL = process.argv[2] ?? 'http://localhost:3000';
const SESSION_COOKIE = process.argv[3];

const c = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  blue: (s: string) => `\x1b[34m${s}\x1b[0m`,
  gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

type TestResult = {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  detail?: string;
  latencyMs?: number;
};

const results: TestResult[] = [];

function record(r: TestResult) {
  results.push(r);
  const icon =
    r.status === 'PASS' ? c.green('✓') : r.status === 'FAIL' ? c.red('✗') : c.yellow('○');
  const lat = r.latencyMs !== undefined ? c.gray(` (${r.latencyMs}ms)`) : '';
  const detail = r.detail ? c.gray(' — ' + r.detail) : '';
  console.log(`  ${icon} ${r.name}${lat}${detail}`);
}

async function fetchWithAuth(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (SESSION_COOKIE) {
    headers.set('Cookie', `cg_at=${SESSION_COOKIE}`);
  }
  return fetch(`${BASE_URL}${path}`, { ...init, headers });
}

async function testHealth() {
  console.log(c.bold('\n[#1] Health endpoint'));
  const start = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/api/health`);
    const data = (await res.json()) as {
      status: string;
      checks: Record<
        string,
        { ok: boolean; latencyMs?: number; detail?: string; extra?: Record<string, unknown> }
      >;
    };
    const latencyMs = Date.now() - start;

    if (res.status !== 200 && res.status !== 503) {
      record({
        name: 'Status code 200 or 503',
        status: 'FAIL',
        detail: `got ${res.status}`,
        latencyMs,
      });
      return;
    }
    record({ name: 'Endpoint responsive', status: 'PASS', latencyMs });

    const dbOk = data.checks.db?.ok;
    record({
      name: 'DB primary',
      status: dbOk ? 'PASS' : 'FAIL',
      detail: dbOk ? `latency ${data.checks.db?.latencyMs}ms` : data.checks.db?.detail,
    });

    const redisOk = data.checks.redis?.ok;
    const redisMode = data.checks.redis?.extra?.mode;
    record({
      name: 'Redis (rate limit + cost guardrail)',
      status: redisOk ? 'PASS' : 'FAIL',
      detail: redisOk
        ? `mode=${redisMode}, latency ${data.checks.redis?.latencyMs}ms`
        : data.checks.redis?.detail,
    });

    if ('dbReplica' in data.checks) {
      record({
        name: 'DB replica',
        status: data.checks.dbReplica!.ok ? 'PASS' : 'FAIL',
        detail: `latency ${data.checks.dbReplica!.latencyMs}ms`,
      });
    } else {
      record({
        name: 'DB replica',
        status: 'SKIP',
        detail: 'DATABASE_REPLICA_URL not set (fallback primary)',
      });
    }

    const aiOk = data.checks.aiCircuit?.ok;
    record({
      name: 'AI circuit breaker',
      status: aiOk ? 'PASS' : 'FAIL',
      detail: aiOk
        ? `spent $${(data.checks.aiCircuit!.extra?.spent_usd as number)?.toFixed(4)}`
        : data.checks.aiCircuit?.detail,
    });
  } catch (err) {
    record({
      name: 'Endpoint reachable',
      status: 'FAIL',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

async function testTraceIdGenerated() {
  console.log(c.bold('\n[#2] TraceId middleware (generated)'));
  try {
    const res = await fetch(`${BASE_URL}/api/health`);
    const traceId = res.headers.get('x-trace-id');

    if (!traceId) {
      record({ name: 'x-trace-id header present', status: 'FAIL' });
      return;
    }
    record({ name: 'x-trace-id header present', status: 'PASS', detail: traceId });

    const formatOk = /^cog-[0-9a-f]{16}-[0-9a-f]{8}$/.test(traceId);
    record({
      name: 'Format matches cog-{hex}-{hex}',
      status: formatOk ? 'PASS' : 'FAIL',
      detail: traceId,
    });
  } catch (err) {
    record({
      name: 'TraceId fetch',
      status: 'FAIL',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

async function testTraceIdReuseAndUnique() {
  console.log(c.bold('\n[#3] TraceId uniqueness + upstream reuse'));
  try {
    const customId = 'test-trace-' + Math.random().toString(36).slice(2, 8);
    const res1 = await fetch(`${BASE_URL}/api/health`, {
      headers: { 'x-trace-id': customId },
    });
    const echoed = res1.headers.get('x-trace-id');
    record({
      name: 'Reuse upstream x-trace-id',
      status: echoed === customId ? 'PASS' : 'FAIL',
      detail: `sent=${customId}, got=${echoed}`,
    });

    const [a, b] = await Promise.all([
      fetch(`${BASE_URL}/api/health`),
      fetch(`${BASE_URL}/api/health`),
    ]);
    const idA = a.headers.get('x-trace-id');
    const idB = b.headers.get('x-trace-id');
    record({
      name: 'Distinct ids across requests',
      status: idA !== idB ? 'PASS' : 'FAIL',
      detail: `a=${idA?.slice(0, 20)}..., b=${idB?.slice(0, 20)}...`,
    });
  } catch (err) {
    record({
      name: 'TraceId tests',
      status: 'FAIL',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

async function testCostUsage() {
  console.log(c.bold('\n[#4] Cost guardrail — /api/account/usage'));
  if (!SESSION_COOKIE) {
    record({ name: 'Usage endpoint', status: 'SKIP', detail: 'no session cookie' });
    return;
  }
  try {
    const start = Date.now();
    const res = await fetchWithAuth('/api/account/usage');
    const latencyMs = Date.now() - start;

    if (res.status === 401) {
      record({
        name: 'Auth',
        status: 'FAIL',
        detail: 'cookie invalid/expired — get fresh from DevTools',
        latencyMs,
      });
      return;
    }
    if (res.status !== 200) {
      record({ name: 'Status 200', status: 'FAIL', detail: `got ${res.status}`, latencyMs });
      return;
    }

    const data = (await res.json()) as {
      plan: string;
      quotaUsd: number;
      spentUsd: number;
      remainingUsd: number;
      spentPct: number;
      resetAt: string;
    };
    record({
      name: 'Usage returned',
      status: 'PASS',
      detail: `${data.plan}: $${data.spentUsd.toFixed(4)}/$${data.quotaUsd} (${data.spentPct}%)`,
      latencyMs,
    });

    record({
      name: 'Quota > 0',
      status: data.quotaUsd > 0 ? 'PASS' : 'FAIL',
      detail: `quota=$${data.quotaUsd}`,
    });
    record({
      name: 'remainingUsd math',
      status:
        Math.abs(data.remainingUsd - (data.quotaUsd - data.spentUsd)) < 0.001 ? 'PASS' : 'FAIL',
    });
  } catch (err) {
    record({
      name: 'Usage endpoint',
      status: 'FAIL',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

async function testRouterHappyPath() {
  console.log(c.bold('\n[#5] LLM router — happy path (Haiku classify)'));
  if (!SESSION_COOKIE) {
    record({ name: 'Router test', status: 'SKIP', detail: 'no session cookie' });
    return;
  }
  try {
    const start = Date.now();
    const res = await fetchWithAuth('/api/debug/router-test');
    const latencyMs = Date.now() - start;

    if (res.status === 401) {
      record({ name: 'Auth', status: 'FAIL', detail: 'cookie invalid', latencyMs });
      return;
    }
    if (res.status === 404) {
      record({
        name: 'Endpoint available',
        status: 'FAIL',
        detail: 'route returns 404 — prod mode?',
        latencyMs,
      });
      return;
    }

    const data = (await res.json()) as {
      mode: string;
      provider?: string;
      model?: string;
      text?: string;
      tokens?: { prompt: number; completion: number };
      costUsd?: number;
      latencyMs?: number;
    };

    if (data.mode === 'ok') {
      record({
        name: 'AI generation success',
        status: 'PASS',
        detail: `${data.provider}/${data.model} → "${data.text?.slice(0, 30)}..." cost=$${data.costUsd?.toFixed(6)}`,
        latencyMs: data.latencyMs ?? latencyMs,
      });
    } else if (data.mode === 'cost_blocked') {
      record({
        name: 'AI generation',
        status: 'FAIL',
        detail: `blocked by cost guardrail (acceptable nếu user đã spam earlier)`,
        latencyMs,
      });
    } else {
      record({
        name: 'AI generation',
        status: 'FAIL',
        detail: `unexpected mode=${data.mode}`,
        latencyMs,
      });
    }
  } catch (err) {
    record({
      name: 'Router test',
      status: 'FAIL',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

async function testCircuitState() {
  console.log(c.bold('\n[#6] Circuit breaker state inspect'));
  if (!SESSION_COOKIE) {
    record({ name: 'Circuit state', status: 'SKIP', detail: 'no session cookie' });
    return;
  }
  try {
    const res = await fetchWithAuth('/api/debug/router-test?circuit_state=1');
    if (res.status !== 200) {
      record({ name: 'Endpoint', status: 'FAIL', detail: `got ${res.status}` });
      return;
    }
    const data = (await res.json()) as {
      circuits: Array<{ name: string; state: string; failCount: number }>;
    };
    const closedCount = data.circuits.filter((c) => c.state === 'CLOSED').length;
    record({
      name: `${data.circuits.length} circuits inspected`,
      status: 'PASS',
      detail: `${closedCount}/${data.circuits.length} CLOSED`,
    });
    data.circuits.forEach((cir) => {
      const icon = cir.state === 'CLOSED' ? '✓' : cir.state === 'OPEN' ? '✗' : '○';
      console.log(`    ${c.gray(icon)} ${c.gray(cir.name)}: ${cir.state}, fail=${cir.failCount}`);
    });
  } catch (err) {
    record({
      name: 'Circuit state',
      status: 'FAIL',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

async function testRateLimit() {
  console.log(c.bold('\n[#7] Rate limit (router-test preset aiGenerate = 10/min)'));
  if (!SESSION_COOKIE) {
    record({ name: 'Rate limit', status: 'SKIP', detail: 'no session cookie' });
    return;
  }
  record({
    name: 'Rate limit',
    status: 'SKIP',
    detail: 'Test thật cần auth + endpoint có rate limit (vd /api/chat). Xem manual test #4.',
  });
}

async function main() {
  console.log(c.bold(`\n🧪 Cogniva Smoke Test — Stage 1 W1-4`));
  console.log(c.gray(`Base URL: ${BASE_URL}`));
  console.log(
    c.gray(`Auth: ${SESSION_COOKIE ? 'session cookie provided' : 'no cookie (auth tests skip)'}`),
  );

  await testHealth();
  await testTraceIdGenerated();
  await testTraceIdReuseAndUnique();
  await testCostUsage();
  await testRouterHappyPath();
  await testCircuitState();
  await testRateLimit();

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;

  console.log(c.bold('\n📊 Summary'));
  console.log(`  ${c.green(`✓ ${passed} passed`)}`);
  if (failed > 0) console.log(`  ${c.red(`✗ ${failed} failed`)}`);
  if (skipped > 0) console.log(`  ${c.yellow(`○ ${skipped} skipped`)}`);

  if (failed > 0) {
    console.log(c.red('\n❌ Some tests failed. Investigate output above.'));
    process.exit(1);
  } else {
    console.log(c.green('\n✅ All tests passed (or skipped).\n'));
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(c.red('\n💥 Fatal error in smoke test:'), err);
  process.exit(1);
});
