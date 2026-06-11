import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const PROFILE = __ENV.K6_PROFILE || 'smoke';

const errorRate = new Rate('errors');
const healthLatency = new Trend('health_latency', true);
const landingLatency = new Trend('landing_latency', true);

const profiles = {
  smoke: {
    stages: [
      { duration: '10s', target: 1 },
      { duration: '20s', target: 1 },
    ],
    thresholds: {
      http_req_duration: ['p(95)<1000'],
      errors: ['rate<0.01'],
    },
  },
  load: {
    stages: [
      { duration: '1m', target: 25 },
      { duration: '5m', target: 50 },
      { duration: '30s', target: 0 },
    ],
    thresholds: {
      http_req_duration: ['p(95)<500', 'p(99)<1500'],
      errors: ['rate<0.02'],
      health_latency: ['p(95)<200'],
      landing_latency: ['p(95)<800'],
    },
  },
  stress: {
    stages: [
      { duration: '2m', target: 100 },
      { duration: '3m', target: 300 },
      { duration: '5m', target: 500 },
      { duration: '1m', target: 0 },
    ],
    thresholds: {
      http_req_duration: ['p(95)<3000'],
      errors: ['rate<0.10'],
    },
  },
  spike: {
    stages: [
      { duration: '10s', target: 200 },
      { duration: '30s', target: 200 },
      { duration: '10s', target: 0 },
    ],
    thresholds: {
      'http_req_failed{status:5xx}': ['rate<0.05'],
    },
  },
};

export const options = {
  ...profiles[PROFILE],
  tags: {
    profile: PROFILE,
    app: 'cogniva-web',
  },
};

export default function () {
  const r = Math.random();
  if (r < 0.6) {
    testHealthEndpoint();
  } else {
    testLandingPage();
  }
}

function testHealthEndpoint() {
  const res = http.get(`${BASE_URL}/api/health`, {
    tags: { endpoint: 'health' },
  });

  const passed = check(res, {
    'health: status 200 or 503': (r) => [200, 503].includes(r.status),
    'health: latency < 500ms': (r) => r.timings.duration < 500,
    'health: x-trace-id present': (r) => !!r.headers['X-Trace-Id'] || !!r.headers['x-trace-id'],
  });

  healthLatency.add(res.timings.duration);
  errorRate.add(!passed);

  sleep(0.1 + Math.random() * 0.4);
}

function testLandingPage() {
  const res = http.get(`${BASE_URL}/`, {
    tags: { endpoint: 'landing' },
  });

  const passed = check(res, {
    'landing: status 200': (r) => r.status === 200,
    'landing: TTFB < 800ms': (r) => r.timings.waiting < 800,
    'landing: body contains Cogniva': (r) =>
      typeof r.body === 'string' && r.body.includes('Cogniva'),
  });

  landingLatency.add(res.timings.duration);
  errorRate.add(!passed);

  sleep(0.5 + Math.random() * 1.0);
}

export function handleSummary(data) {
  const summary = {
    profile: PROFILE,
    timestamp: new Date().toISOString(),
    metrics: {
      http_req_duration: data.metrics.http_req_duration.values,
      http_req_failed: data.metrics.http_req_failed.values,
      health_latency: data.metrics.health_latency?.values,
      landing_latency: data.metrics.landing_latency?.values,
      errors: data.metrics.errors?.values,
    },
    thresholds_passed: Object.keys(data.metrics).every((m) => {
      const metric = data.metrics[m];
      if (!metric.thresholds) return true;
      return Object.values(metric.thresholds).every((t) => !t.ok === false);
    }),
  };

  return {
    stdout: textSummary(data, { indent: '  ', enableColors: true }),
    'summary.json': JSON.stringify(summary, null, 2),
  };
}

function textSummary(data, opts) {
  const i = opts.indent;
  let out = '\n';
  out += `${i}📊 Cogniva Load Test — ${PROFILE} profile\n\n`;

  if (data.metrics.http_reqs) {
    out += `${i}  Total requests: ${data.metrics.http_reqs.values.count}\n`;
    out += `${i}  Avg RPS:        ${data.metrics.http_reqs.values.rate.toFixed(1)}\n\n`;
  }

  if (data.metrics.http_req_duration) {
    const d = data.metrics.http_req_duration.values;
    out += `${i}  HTTP duration:\n`;
    out += `${i}    avg:  ${d.avg.toFixed(0)}ms\n`;
    out += `${i}    p50:  ${d.med.toFixed(0)}ms\n`;
    out += `${i}    p95:  ${d['p(95)'].toFixed(0)}ms\n`;
    out += `${i}    p99:  ${d['p(99)'].toFixed(0)}ms\n`;
    out += `${i}    max:  ${d.max.toFixed(0)}ms\n\n`;
  }

  if (data.metrics.http_req_failed) {
    const f = data.metrics.http_req_failed.values;
    out += `${i}  Failed rate:    ${(f.rate * 100).toFixed(2)}%\n\n`;
  }

  if (data.metrics.health_latency) {
    const h = data.metrics.health_latency.values;
    out += `${i}  Health endpoint P95: ${h['p(95)'].toFixed(0)}ms\n`;
  }
  if (data.metrics.landing_latency) {
    const l = data.metrics.landing_latency.values;
    out += `${i}  Landing page P95:    ${l['p(95)'].toFixed(0)}ms\n`;
  }

  return out;
}
