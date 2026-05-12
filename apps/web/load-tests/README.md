# Cogniva Load Testing — k6 baseline

> Plan v2 §15.1 W8 / §21 — Stage 1 capacity baseline.

## Setup

**Install k6:**
- Windows: `winget install k6` hoặc `choco install k6`
- Mac:     `brew install k6`
- Linux:   `sudo apt install k6` (sau khi add repo)
- Docker:  `docker pull grafana/k6`

**Verify:** `k6 version`

## Run

```bash
# Smoke test (1 VU, 30s) — verify scripts work
K6_PROFILE=smoke k6 run apps/web/load-tests/baseline.js

# Load test (50 VU, 5min sustain)
K6_PROFILE=load k6 run apps/web/load-tests/baseline.js

# Stress test (ramp to 500 VU, find breaking point)
K6_PROFILE=stress k6 run apps/web/load-tests/baseline.js

# Spike test (sudden 200 VU)
K6_PROFILE=spike k6 run apps/web/load-tests/baseline.js
```

Override base URL:
```bash
BASE_URL=https://staging.cogniva.app K6_PROFILE=load k6 run apps/web/load-tests/baseline.js
```

## Profiles

| Profile | Duration | Peak VU | Use case |
|---|---|---|---|
| smoke | 30s | 1 | CI smoke verify scripts |
| load | 6m30s | 50 | Baseline numbers per release |
| stress | 11m | 500 | Find breaking point monthly |
| spike | 50s | 200 | DoS simulation quarterly |

## Baseline Stage 1 targets (M3 end)

| Metric | Target | Current (M2) |
|---|---|---|
| Health P95 | < 200ms | ~50ms (warm) |
| Landing P95 | < 800ms | ~600ms (Vercel cold ~1.2s) |
| API P95 | < 500ms | TBD |
| Error rate | < 2% | < 0.5% |
| 50 VU sustained | RPS > 40 | TBD |

## Interpretation

- **All thresholds pass** → green, ship
- **Some warn (yellow)** → investigate but not block
- **Critical fail** → block deploy
- **Stress test plateau** → that's our capacity ceiling

## CI integration (Stage 2)

```yaml
# .github/workflows/load-test.yml
on:
  pull_request:
    branches: [main]

jobs:
  k6:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: grafana/setup-k6-action@v1
      - run: |
          # Spin up preview deploy URL
          PREVIEW=$(vercel deploy --token=${{ secrets.VERCEL_TOKEN }})
          BASE_URL=$PREVIEW K6_PROFILE=smoke k6 run apps/web/load-tests/baseline.js
      - uses: actions/upload-artifact@v4
        with:
          name: k6-summary
          path: summary.json
```

## Production load test (CAREFUL)

KHÔNG chạy `stress` profile lên production unless:
- Approved by team
- Off-peak hours (2-4am UTC)
- Status page banner advance
- On-call standby

Production load test mục đích chính:
- Verify auto-scale works
- Catch regression sau deploy
- Plan capacity trước peak season (exam week)

## Tools cộng dồn

- [k6 docs](https://k6.io/docs)
- [k6 dashboard](https://github.com/grafana/xk6-dashboard) — real-time UI
- [Grafana k6 Cloud](https://k6.io/cloud) — distributed VU (Stage 2)
