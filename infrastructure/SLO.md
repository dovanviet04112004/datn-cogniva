# Cogniva — Service Level Objectives

> Plan v2 §9.3 — SLO definitions cho Stage 1.
>
> **Stage hiện tại:** Stage 1 (M1-M3, 0 → 5K MAU)
> **Target uptime:** 99.5% (3.6h downtime/month acceptable)
> **Stage 2 target:** 99.9% (43min/month)
> **Stage 3 target:** 99.95% (21min/month)
>
> **Error budget policy:**
> - < 50% burned → ship features as usual
> - 50-100% burned → focus on reliability, fewer ship
> - > 100% burned → freeze non-critical, all hands fix

---

## 10 critical SLOs

### SLO-1: Web app responsiveness
- **SLI:** P95 page TTFB (server response start)
- **Target:** < 500ms (Stage 1) → < 200ms (Stage 2)
- **Measurement:** Vercel Speed Insights + RUM
- **Error budget Stage 1:** 0.5% of requests = 21.6 min/month above 500ms

### SLO-2: API responsiveness
- **SLI:** P99 API route handler duration
- **Target:** < 1s (Stage 1) → < 500ms (Stage 2)
- **Measurement:** Sentry Performance
- **Exclude:** AI streaming endpoints, file upload, long-poll
- **Error budget:** 1% requests above target

### SLO-3: Auth success rate
- **SLI:** Successful sign-in / total attempts (excluding wrong-password)
- **Target:** 99.9%
- **Measurement:** Sentry breadcrumb + posthog events
- **Error budget:** 0.1% — vd 1000 attempt thì 1 fail OK

### SLO-4: AI first token (TTFT)
- **SLI:** Time from request → first token streamed
- **Target Sonnet:** P95 < 2s (Stage 1) → 1.5s (Stage 2) → 900ms (Stage 3)
- **Target Haiku:** P95 < 600ms (Stage 1) → 450ms (Stage 2)
- **Measurement:** Langfuse traces (latency field)
- **Error budget:** 1% requests above target

### SLO-5: RAG faithfulness
- **SLI:** RAGAS faithfulness score on sampled responses (5% sampling)
- **Target:** > 0.85
- **Measurement:** Async eval Inngest job on production samples
- **Error budget:** 5% requests faithfulness < 0.85
- **Action:** > 5% drop sustained 7 days → freeze prompt change, investigate

### SLO-6: Flashcard review save
- **SLI:** Latency POST /api/flashcards/[id]/review
- **Target:** P95 < 300ms (FSRS calc + DB write)
- **Measurement:** Sentry transactions
- **Why critical:** habit-forming hot path, lag → user drop streak

### SLO-7: Database query
- **SLI:** P99 Postgres query time (excluding analytics/heavy)
- **Target:** < 100ms (Stage 1) → < 50ms (Stage 2)
- **Measurement:** trackQuery wrapper (db-monitor.ts)
- **Action:** > 100ms P99 sustained → check missing index

### SLO-8: Chat message delivery (rooms)
- **SLI:** Time from POST /chat → Soketi broadcast receive on other client
- **Target:** P95 < 1s (Stage 1) → 500ms (Stage 2)
- **Measurement:** Client-side timestamp diff (PostHog event)
- **Error budget:** 0.5% messages above target

### SLO-9: AI cost / user / month
- **SLI:** Total AI cost across all users / MAU
- **Target:** < $1.50/user (Stage 1) → < $1.20 (Stage 2) → < $0.80 (Stage 3)
- **Measurement:** Cost guardrail recordCost aggregated daily
- **Action:** > target sustained 1 week → review prompt cache + routing

### SLO-10: Backup integrity
- **SLI:** Monthly DR drill restore + sanity check pass
- **Target:** 100% (every drill must pass)
- **Measurement:** restore-drill.sh exit code + webhook
- **Action:** Drill fail = SEV2 incident, fix within 7 days

---

## Composite uptime calculation

Service "UP" = SLO-1 + SLO-2 + SLO-3 + SLO-7 all in budget.

| Subsystem | Weight | Notes |
|---|---|---|
| Web app | 30% | Critical user-facing |
| API | 25% | Backbone |
| Auth | 20% | Without auth, app useless |
| DB | 15% | Read replica failover OK |
| AI | 10% | Degraded mode acceptable |

Calculation:
```
uptime% = sum(weight × subsystem_available%)
```

---

## Monitoring + Alerting

### Where metrics live

| Metric | Tool | Dashboard |
|---|---|---|
| P95/P99 latency | Sentry Performance | sentry.io project Cogniva |
| LLM cost + tokens | Langfuse | cloud.langfuse.com |
| Error rate | Sentry Issues | sentry.io issues |
| User events | PostHog | app.posthog.com |
| Sys logs | Better Stack | betterstack.com |
| Custom (cost, FSRS) | Postgres + Grafana | (Stage 2) |

### Alert routing

| Severity | Route | Response |
|---|---|---|
| SEV1 (prod down) | PagerDuty → phone | < 5 min ack |
| SEV2 (degraded) | PagerDuty → app push | < 15 min ack |
| SEV3 (warning) | Slack #alerts | next business hour |
| SEV4 (info) | Email weekly digest | low-pri review |

### Alert examples

```yaml
# Sentry alert: error rate spike
- name: "API error rate > 1%"
  condition: error_rate(api) > 0.01 over 5min
  severity: SEV2

- name: "LLM cost spike"
  condition: cost_per_minute > $5 sustained 10min
  severity: SEV2

- name: "DB P99 > 500ms"
  condition: db_query_p99 > 500ms over 10min
  severity: SEV2

- name: "Backup failed"
  condition: backup.completed event missing > 25h
  severity: SEV1

- name: "Restore drill failed"
  condition: drill.status=failed
  severity: SEV2
```

---

## Reporting cadence

- **Weekly:** error budget burn report → eng team Slack
- **Monthly:** SLO compliance review + post-mortem highlights
- **Quarterly:** SLO target re-evaluation (raise targets as we scale)

---

## Action items theo error budget state

### Green (< 50% burned)
- Ship features normally
- Experiment with new things
- Refactor as needed

### Yellow (50-90% burned)
- Slow down feature work
- Prioritize observability + bug fixes
- Reduce canary % for risky changes
- Pause deps upgrade non-critical

### Red (90-100% burned)
- Freeze non-critical features
- All eng focus on reliability
- Post-mortem every incident regardless severity
- Daily status email to team

### Bleeding (> 100% burned)
- Emergency war room
- Halt all deploys except hotfix
- Customer comms on status page
- Executive review weekly until recovered

---

## SLO budget tracker

Track in Notion/Linear weekly. Format:

| SLO | Target | Actual (last 30d) | Budget remaining | Status |
|---|---|---|---|---|
| SLO-1 (web TTFB) | 99.5% < 500ms | 99.7% | 60% | 🟢 |
| SLO-2 (API P99) | 99% < 1s | 98.8% | -20% | 🟡 |
| SLO-3 (auth) | 99.9% | 99.95% | 80% | 🟢 |
| ... | ... | ... | ... | ... |

---

*Last reviewed: 2026-05-11 (Stage 1 baseline). Next review: monthly.*
