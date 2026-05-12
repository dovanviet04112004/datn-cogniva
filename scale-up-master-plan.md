# 🚀 Cogniva — Scale-Up Master Plan v2

> **Bản chất tài liệu:** Đây là **roadmap kỹ thuật 18 tháng** đưa Cogniva từ MVP solo-dev lên platform big-tech-grade (100K-1M concurrent users, multi-region, 99.95% SLA, SOC2 + GDPR + FERPA compliant).
>
> **Khác với v1:** Sửa số liệu sai (Soketi/pgvector/TTFT), chia 3 stage tiến hoá rõ ràng (Hardened Monolith → Distributed Monolith → Microservices Mesh), thêm các layer còn thiếu (Mobile, Growth Analytics, Customer Ops, Education-specific), thêm Risk Register + ADRs + DR playbooks + Anti-patterns.
>
> **Cách đọc:**
> - Nếu bạn là **1-2 eng (hiện tại)** → đọc §0, §1, §2 (Stage 1), §15 (Roadmap M1-M3), §19 (Risk Register). Bỏ qua mọi thứ "Stage 3" — đó là sau khi có funding + team.
> - Nếu bạn là **VC/investor** → §0 (Exec Summary), §1.1 (Targets), §17 (Budget), §15 (Roadmap).
> - Nếu bạn là **CTO/senior eng đang join** → đọc hết. Đặc biệt §3 (Cogniva-specific), §20 (ADRs), §23 (Anti-patterns).
>
> **Warning về dogma:** Plan này có opinion mạnh. Mọi decision nên có ADR khi review lại — context có thể đổi sau 12 tháng. Đừng cargo-cult.

---

## 📑 Mục lục

**Phần 1 — Định hướng**
- §0. [Executive Summary](#0-executive-summary)
- §1. [Vision, Targets & Reality Check](#1-vision-targets--reality-check)
- §2. [Architecture Evolution — 3 Stage](#2-architecture-evolution--3-stage)
- §3. [Cogniva-Specific Engineering Challenges](#3-cogniva-specific-engineering-challenges)

**Phần 2 — Infrastructure Layers**
- §4. [Layer 1 — Edge & Geographic](#4-layer-1--edge--geographic)
- §5. [Layer 2 — Data & Storage](#5-layer-2--data--storage)
- §6. [Layer 3 — Compute & Runtime](#6-layer-3--compute--runtime)
- §7. [Layer 4 — Real-time & Streaming](#7-layer-4--real-time--streaming)
- §8. [Layer 5 — AI/ML Infrastructure](#8-layer-5--aiml-infrastructure)
- §9. [Layer 6 — Observability & Resilience](#9-layer-6--observability--resilience)
- §10. [Layer 7 — Security & Compliance](#10-layer-7--security--compliance)

**Phần 3 — Business-Critical Layers (mới)**
- §11. [Layer 8 — Mobile & Cross-Platform](#11-layer-8--mobile--cross-platform)
- §12. [Layer 9 — Growth & Product Analytics](#12-layer-9--growth--product-analytics)
- §13. [Layer 10 — Customer Operations](#13-layer-10--customer-operations)
- §14. [Layer 11 — Content & Education-Specific](#14-layer-11--content--education-specific)

**Phần 4 — Execution**
- §15. [Phase Roadmap — 18 tháng](#15-phase-roadmap--18-tháng)
- §16. [Team & Hiring](#16-team--hiring)
- §17. [Budget & Cost Projection](#17-budget--cost-projection)
- §18. [Migration Strategy](#18-migration-strategy)

**Phần 5 — Risk, Decisions, Playbooks**
- §19. [Risk Register](#19-risk-register)
- §20. [Architecture Decision Records (ADRs)](#20-architecture-decision-records-adrs)
- §21. [Load Testing & Capacity Planning](#21-load-testing--capacity-planning)
- §22. [Disaster Recovery Playbooks](#22-disaster-recovery-playbooks)
- §23. [Anti-patterns & Cargo-cult Avoidance](#23-anti-patterns--cargo-cult-avoidance)
- §24. [Definition of Done](#24-definition-of-done)

**Appendices**
- A. [Reference architectures from big tech](#appendix-a--reference-architectures)
- B. [Papers, talks, books worth reading](#appendix-b--references)
- C. [Vendor evaluation rubric](#appendix-c--vendor-evaluation-rubric)
- D. [Engineering culture playbook](#appendix-d--engineering-culture-playbook)

---

## 0. Executive Summary

### 0.1. Tóm tắt 1 trang

Cogniva hiện là Next.js monolith ổn trên Vercel + Postgres + Soketi self-host. Stack này handle được **~500 concurrent / 5K MAU** trước khi bắt đầu vỡ. Để scale lên **100K-1M concurrent** trong 18 tháng, hệ thống phải tiến hoá qua **3 stage** thay vì rewrite-from-scratch:

| Stage | Thời gian | Users | Hình thái | Đầu tư chính |
|---|---|---|---|---|
| **1. Hardened Monolith** | M1-M3 (3 tháng) | 0 → 5K MAU | Monolith Next.js + Redis cache + read replica + observability | 1-2 eng, $1-3K/mo infra |
| **2. Distributed Monolith** | M4-M12 (9 tháng) | 5K → 100K MAU | Multi-region edge + tách Notification/Chat service ra Go + Centrifugo WS + Qdrant vectors | 5-8 eng, $15-40K/mo infra |
| **3. Microservices Mesh** | M13-M18+ (6+ tháng) | 100K → 1M MAU | 10-12 service độc lập, Linkerd mesh, multi-region writes, self-host inference, SOC2 cert | 12-20 eng, $80-200K/mo infra |

### 0.2. Top 10 quyết định lớn

1. **KHÔNG rewrite-from-scratch** — strangler fig, mọi migration có rollback.
2. **KHÔNG đa cloud quá sớm** — Stage 1-2 ở Vercel + Hetzner. Cloudflare cho edge. Đến Stage 3 mới add AWS region.
3. **Postgres giữ lại tới 50K DAU** — Neon + read replica đủ. KHÔNG dùng CockroachDB chỉ vì "multi-region writes nghe oai". Ed-tech không cần.
4. **pgvector tới 100M chunks** — KHÔNG migrate Qdrant sớm. Benchmark mới migrate.
5. **Soketi tới 50K WS concurrent** — KHÔNG migrate Centrifugo sớm. Số "10K conn/node" trong v1 là sai.
6. **Service decomposition khi đau, không phải khi đủ to** — đau = team không deploy độc lập được, không phải LOC > X.
7. **Mobile bắt đầu Month 4** — KHÔNG sớm hơn (web chưa stable), không muộn hơn (ed-tech 70% mobile traffic).
8. **AI eval framework là blocking** — không deploy LLM change nếu eval drop > 3%. Phase 1 việc đầu tiên sau Foundation.
9. **Compliance là driver, không phải afterthought** — FERPA + COPPA cần thiết kế DB từ đầu (data residency, parental consent, retention policy).
10. **Cost ceiling per feature** — mỗi feature có budget $/user/month. Vượt ngân sách = không ship hoặc tối ưu trước.

### 0.3. Top 5 rủi ro phải mitigate sớm

1. **Solo-dev burnout** — không có on-call rotation, 1 ngày sốt → service degraded. Mitigation: hire DevOps Month 2.
2. **AI cost runaway** — 1 prompt template lỗi có thể $5K/day. Mitigation: per-user quota + cost circuit breaker Month 1.
3. **Compliance lag** — EU user xuất hiện trước khi GDPR ready → blocked launch. Mitigation: DPA + privacy policy Month 2.
4. **Data loss** — không có DR drill, backup chưa restore-test. Mitigation: monthly restore drill từ Month 1.
5. **Vendor lock-in** — Vercel function 10min timeout không scale AI streaming dài. Mitigation: abstraction layer, alt deploy Fly.io.

### 0.4. Success criteria 18 tháng (realistic, KHÔNG fake)

- **Performance:** P95 API < 200ms regional, < 500ms global (KHÔNG 100ms global — vi phạm physics nếu chưa edge cache hoàn chỉnh)
- **Reliability:** 99.95% uptime (KHÔNG 99.99% — cần SRE team full-time)
- **AI quality:** Faithfulness ≥ 0.85, eval scores stable hoặc improving qua mỗi release
- **Cost:** < $1/user/month infra (KHÔNG $0.50 — đó là Notion sau 5 năm tối ưu)
- **Compliance:** SOC2 Type 1 + GDPR + FERPA-ready (KHÔNG SOC2 Type 2 — cần 12 tháng audit)
- **Scale:** 100K MAU sustained + 5K peak concurrent — KHÔNG 1M (đó là 24-36 tháng)

---

## 1. Vision, Targets & Reality Check

### 1.1. Target scale metrics (realistic, fact-checked)

| Metric | MVP hiện tại | M6 target | M12 target | M18 target | Reference big-tech (verified) |
|---|---|---|---|---|---|
| Concurrent users | 50 | 2K | 20K | 100K | Discord 15M peak, Notion live edit 500K |
| DAU | < 100 | 5K | 50K | 200K | Linear 200K, Notion 5M |
| API P95 (same region) | 500ms | 200ms | 120ms | 80ms | Stripe 50ms, Cloudflare 30ms |
| API P95 (cross-region) | N/A | 600ms | 300ms | 180ms | Realistic với edge cache |
| AI TTFT P95 (Sonnet) | 2.0s | 1.5s | 1.2s | 900ms | Claude raw 800-1500ms |
| AI TTFT P95 (Haiku) | N/A | 600ms | 450ms | 350ms | Haiku raw 200-500ms |
| AI TTFT P95 (Groq Llama) | N/A | 200ms | 180ms | 150ms | Groq raw 100-200ms |
| WebRTC RTT intra-region | 80ms | 50ms | 40ms | 35ms | Discord 50ms intra-region |
| WebRTC RTT inter-region | 200ms | 180ms | 160ms | 140ms | Physics floor: TY-FRA 180ms RTT |
| WebSocket msg delivery | 100ms | 60ms | 40ms | 30ms | Slack 50ms |
| Page LCP (cold) | 2.5s | 1.8s | 1.2s | 900ms | Notion 1s |
| Page LCP (warm) | 1.5s | 800ms | 500ms | 300ms | Vercel edge cache |
| Uptime SLA | 99% | 99.5% | 99.9% | 99.95% | AWS 99.99% requires 5-15 SRE |
| Cost / user / month | $2.50 | $1.80 | $1.20 | $0.80 | Notion ~$0.40 (5y tối ưu) |
| Data residency | Single | Single | EU+US | EU+US+APAC | — |
| Compliance | None | GDPR | +SOC2 T1 +FERPA | +SOC2 T2 +HIPAA-ready | — |

**Note quan trọng về TTFT:**
- "AI first token < 400ms" không phải bất khả thi, NHƯNG chỉ với Groq + Llama nhỏ. Với Claude (chat chính của Cogniva) → physics floor là ~600ms vì model size.
- Plan v1 mục tiêu < 400ms với Claude → sai factual. v2 sửa: < 900ms với Claude, < 350ms với Haiku/Groq.

**Note về uptime:**
- 99.99% = 4 phút 23 giây downtime/tháng. Không đạt được nếu chỉ có 1-2 eng + on-call.
- 99.95% = 21 phút/tháng. Realistic với 5-8 eng team.
- 99.9% = 43 phút/tháng. Realistic với 2-3 eng on-call rotation.
- 99% = 7 giờ/tháng. Hiện tại MVP.

### 1.2. Physics & math reality check

#### 1.2.1. Tốc độ ánh sáng (latency floor)

| Route | One-way (theoretical) | RTT (realistic) | Note |
|---|---|---|---|
| Hà Nội ↔ Singapore | 15ms | 50-70ms | Có fiber direct |
| HN ↔ Tokyo | 25ms | 70-90ms | Qua HK/SG hop |
| HN ↔ Frankfurt | 80ms | 180-220ms | Qua SG-FRA cable |
| HN ↔ Virginia | 90ms | 200-260ms | Qua trans-Pacific |
| SG ↔ FRA | 75ms | 170-200ms | SeaMeWe cable |
| FRA ↔ IAD | 40ms | 90-110ms | TAT cable |

**Implication:** Mọi target "global P95 < 100ms" yêu cầu edge cache HIT — origin call vẫn 200ms+.

#### 1.2.2. WebRTC RTT physics

- Same-city: 5-20ms (LiveKit Discord-tier)
- Same-region: 30-80ms (intra-VN, intra-EU)
- Cross-Pacific: 180-280ms (HN ↔ US East)
- **Floor:** không vượt qua được fiber + router hops. Cascading SFU giúp **subjective quality** (audio sync), không giảm RTT.

#### 1.2.3. Team capacity math

Quy tắc thực nghiệm engineering:
- 1 engineer = ~1500 LOC/tuần production code (test + review + meeting)
- 1 eng full-time = ~40h/tuần thực hợp 25-30h focus
- Maintenance cost = 50-70% capacity sau khi codebase > 100K LOC
- On-call = -30% capacity tuần on-call
- Hiring lead time = 2-4 tháng để productive

**Implication:** Plan v1 yêu cầu "Month 5-6 extract Chat service sang Go" với 1-2 eng = không thực hiện được. v2 dời sang Stage 2 với hire trước.

#### 1.2.4. Cost reality

| Vendor | Stated price | Real price ở scale Cogniva | Note |
|---|---|---|---|
| Vercel Pro | $20/seat | $0 thực (Hobby đủ tới 5K MAU) | Function exec mới đắt |
| Vercel function exec | $40/1M GB-s | Có thể $200-2K/mo ở 50K MAU | Watch out cho AI streaming |
| Neon Pro | $19/mo | $50-200/mo (compute) | Branching ăn compute |
| OpenAI Whisper | $0.006/min | $360/mo cho 60K phút | Cogniva recording heavy |
| Anthropic Sonnet | $3/$15 per M tokens | $300-3K/mo ở 5K MAU | Cache cứu được 70% |
| Cloudflare R2 | $0.015/GB storage | $5-50/mo | Free egress |
| Inngest | $0/free → $250/mo | $250 cần khi > 50K function runs | Self-host alt: Trigger.dev |
| Soketi self-host (Hetzner) | $0 | $20/mo VPS | OK tới 50K WS |
| LiveKit self-host | $0 | $40-120/mo Hetzner | Phụ thuộc concurrent participants |
| LiveKit Cloud | $0.0048/min participant | $480/mo cho 100K phút | Tăng cao khi MAU lớn |

### 1.3. Architecture principles (revised)

**Core 8:**
1. **Evolve, don't rewrite** — strangler fig pattern, mọi migration parallel + dual-write.
2. **Postgres until it hurts** — chỉ migrate khi đo lường thật sự bottleneck, không phải "nghe nói scale".
3. **Edge by exception** — workload phù hợp mới edge (read-heavy, geo-distributed). Long-lived (AI streaming) ở origin.
4. **Stateless compute, stateful data** — service không giữ session state, tất cả ở Redis/DB.
5. **Event-driven for async** — Kafka/Inngest cho cross-service. Sync HTTP cho user-facing.
6. **Cache hierarchy** — browser → CDN → edge → app → DB. 4-5 layer trước khi đụng DB.
7. **Graceful degradation > perfect reliability** — LLM down → cached. Search down → recent. Real-time down → polling.
8. **Cost-aware từ Day 1** — mỗi feature có $/user budget. Vượt = không ship.

**Anti-principles (KHÔNG làm):**
1. **KHÔNG service-decompose trước PMF** — premature, ops nightmare.
2. **KHÔNG multi-cloud trước M12** — Vercel + Hetzner đủ. AWS chỉ khi có compliance/customer demand.
3. **KHÔNG Kubernetes trước 30 services** — Fly.io / Nomad đủ.
4. **KHÔNG service mesh trước 15 services** — Linkerd cũng có overhead.
5. **KHÔNG GraphQL trước 10 client app** — tRPC/REST đủ cho web + mobile.
6. **KHÔNG self-host LLM trước cost > $10K/mo** — break-even math không lợi.
7. **KHÔNG rewrite Go/Rust microservice trước khi monolith TS đo được bottleneck** — Node TS scale hơn người ta nghĩ.

### 1.4. Cogniva-specific constraints (tại sao plan generic không hợp)

1. **Ed-tech traffic pattern:** peak buổi tối VN time (19h-23h), tuần 7-8 trước kỳ thi → 5-10x baseline. Plan capacity theo peak, không theo average.
2. **AI cost dominant:** 60-80% infra cost là LLM (vs 30% cho generic SaaS). Mọi optimization phải ưu tiên AI cost.
3. **Long-tail content quality:** 1 user upload doc kém → cả mastery model lệch. Cần content QA gate.
4. **Compliance ed-specific:** FERPA (US), COPPA (under 13), data residency cho EU schools, Vietnamese MOET nếu enterprise.
5. **Multi-tenant per school/org:** không phải multi-tenant flat — phân cấp School → Class → Student. Plan từ đầu.
6. **Mobile heavy:** ed-tech 60-70% traffic mobile (vs 30% B2B SaaS). KHÔNG đợi 12 tháng mới làm mobile.
7. **Vietnamese first, global aspiration:** font, tokenizer, OCR, voice phải VN trước. Sau đó i18n.
8. **Synchronous learning (rooms) vs async (flashcards):** 2 workload độc lập, scale độc lập.

---

## 2. Architecture Evolution — 3 Stage

Cogniva tiến hoá qua **3 stage** rõ ràng, mỗi stage có exit criteria. KHÔNG nhảy stage. KHÔNG dừng giữa stage.

### 2.1. Stage 1 — Hardened Monolith (M1-M3, 0 → 5K MAU)

**Mục tiêu:** Stop bleeding. Fix các bottleneck rõ ràng đã biết. Đo lường. Build foundation cho Stage 2.

**Hình thái:**
```
                ┌─ Cloudflare (DNS + WAF + CDN cache static) ─┐
                │                                              │
User ──HTTPS──► │  Vercel Edge (Next.js SSR + Edge functions) │
                │           │                                  │
                │           ▼                                  │
                │  Next.js API routes (Node runtime)           │
                │           │                                  │
                │     ┌─────┼─────┐                            │
                │     ▼     ▼     ▼                            │
                │ Postgres Redis Inngest                       │
                │ (Neon)  (Upstash) (cloud)                    │
                │  │                                            │
                │  └─► read replica (Neon EU + APAC)           │
                └──────────────────────────────────────────────┘

Realtime: Soketi self-host Hetzner (2 replica) + LiveKit single-node Hetzner
Storage: R2 (documents + recordings)
Observability: Sentry + PostHog + Langfuse + Better Stack logs
```

**Đặc trưng Stage 1:**
- 1 codebase Next.js monolith
- 1 Postgres primary + 2 read replica
- Redis cho cache + rate limit + queue secondary
- Inngest cho background job
- LiveKit + Soketi self-host trên 1 VPS Hetzner
- Observability cơ bản nhưng đầy đủ 3 pillar
- KHÔNG có service mesh, KHÔNG có event backbone, KHÔNG có microservice

**Bottleneck phải fix trong Stage 1 (P0):**
1. Rate limiter in-memory → Upstash Redis (M1 W1)
2. Better Auth session DB lookup → JWT + Redis session cache (M1 W2)
3. Single Postgres → +2 read replica + pgBouncer (M1 W3)
4. No observability → Sentry + Langfuse + Grafana basic (M1 W4)
5. No load test → k6 + baseline numbers (M2 W1)
6. No cost guardrail → per-user AI quota + cost alarm (M2 W2)
7. No backup drill → monthly restore test (M2 W3)
8. No feature flag → PostHog feature flags (M2 W4)

**Exit criteria để chuyển Stage 2:**
- ✅ 5K MAU sustained 4 tuần
- ✅ P95 API < 250ms (single region)
- ✅ AI cost / user / month < $1.20
- ✅ Sentry critical errors < 5/tuần
- ✅ Restore drill thành công 2 lần liên tiếp
- ✅ Load test pass: 1K concurrent, 50 req/s sustained
- ✅ Hired: 1 DevOps + 1 senior eng

### 2.2. Stage 2 — Distributed Monolith (M4-M12, 5K → 100K MAU)

**Mục tiêu:** Geographic distribution + extract 2-3 service quan trọng + scale data layer + ship mobile.

**Hình thái:**
```
                ┌─ Cloudflare Workers (edge gateway) ─┐
                │  + DurableObjects rate limit         │
                │  + Cloudflare Images                 │
                │  + R2 (CDN-fronted)                  │
                └──────┬───────────┬───────────────────┘
                       │           │
                       ▼           ▼
                  [APAC region]  [EU region]
                  ┌──────────┐   ┌──────────┐
                  │ Vercel   │   │ Vercel   │
                  │ Next.js  │   │ Next.js  │
                  └────┬─────┘   └────┬─────┘
                       │              │
                       └──────┬───────┘
                              ▼
                  ┌──── extracted services ────┐
                  │ Notification Service (Node)│
                  │ Chat Service (Go)          │
                  │ AI Service (Node + Mastra) │
                  └────────────┬───────────────┘
                               │
                ┌──── data layer ────┐
                │ Neon Postgres      │  primary US + replica EU/APAC
                │ Qdrant Cloud       │  (Khi pgvector > 50M vectors)
                │ Upstash Redis      │  + DragonflyDB self-host nếu cần
                │ ClickHouse Cloud   │  (analytics, từ M6)
                │ Inngest Cloud      │
                │ R2                 │
                └────────────────────┘
                
Realtime: Soketi cluster 4 node + LiveKit cluster 2 region
Mobile: React Native Expo (iOS + Android), shipped M6
```

**Đặc trưng Stage 2:**
- Multi-region edge (auth, rate limit, cache ở Cloudflare Workers)
- 2 Vercel deployment (APAC + EU) cho geo-affinity
- 2-3 service extract (Notification, Chat, AI service) — vẫn share DB
- Mobile app shipped (M6)
- Data layer thêm Qdrant (vectors) + ClickHouse (analytics) khi cần
- LiveKit cluster 2-region với cascading
- SOC2 Type 1 audit (M10-M12)

**Critical work Stage 2:**
1. Cloudflare Workers edge gateway (M4-M5)
2. LiveKit cluster 2-region (M5-M6)
3. React Native mobile shipped (M6-M7)
4. Notification service extract → Go (M7-M8)
5. Chat service extract → Go (M8-M9)
6. ClickHouse analytics pipeline (M9-M10)
7. Qdrant migration (only if pgvector P95 > 200ms at > 30M chunks) (M10-M11)
8. SOC2 Type 1 prep + audit (M10-M12)
9. Feature flag platform mature (LaunchDarkly hoặc PostHog) (suốt stage)

**Exit criteria để chuyển Stage 3:**
- ✅ 100K MAU sustained 4 tuần
- ✅ P95 API < 150ms regional, < 400ms cross-region
- ✅ Mobile DAU > 30% total DAU
- ✅ AI cost / user / month < $1.00
- ✅ 99.9% uptime achieved 6 tháng liên tiếp
- ✅ SOC2 Type 1 certified
- ✅ Hired: 1 SRE + 1 Senior Backend + 1 Frontend + 1 ML/Data + 1 Mobile

### 2.3. Stage 3 — Microservices Mesh (M13-M18+, 100K → 1M MAU)

**Mục tiêu:** Full distributed system. Multi-region active-active. Self-host inference. Compliance maturity.

**Hình thái:**
```
              ┌─── Cloudflare Edge (300+ POPs) ───┐
              │                                    │
              ▼                                    ▼
        [APAC: SG/TY]   [EU: FRA/LON]    [AMER: IAD/SFO]
        ┌──────────┐    ┌──────────┐     ┌──────────┐
        │ Edge GW  │    │ Edge GW  │     │ Edge GW  │
        └────┬─────┘    └────┬─────┘     └────┬─────┘
             │               │                 │
             └───────────────┴─────────────────┘
                            │
                ┌── Service Mesh (Linkerd) ──┐
                │                            │
            ┌───┼───┬────┬────┬────┬────┬───┼───┐
            ▼   ▼   ▼    ▼    ▼    ▼    ▼   ▼   ▼
         [Web][Chat][Room][Exam][Ingest][AI][Notif][Search][Billing]
            │   │   │    │     │      │   │      │       │
            └───┴───┴────┴─────┴──────┴───┴──────┴───────┘
                              │ events
                              ▼
                ┌─── Redpanda (Kafka-compat) ───┐
                └────────────────┬──────────────┘
                                 │
              ┌─── Data Layer (multi-region) ───┐
              │ Neon multi-region writes        │
              │ Qdrant cluster (sharded)        │
              │ ClickHouse (analytics)          │
              │ DragonflyDB cluster             │
              │ Neo4j AuraDB (Khi > 5M concept) │
              └─────────────────────────────────┘
              
AI: Multi-provider (Anthropic + Groq + vLLM Llama self-host)
Realtime: LiveKit 4-region cascading SFU + Centrifugo cluster
Mobile: React Native + native modules (offline-first sync)
```

**Đặc trưng Stage 3:**
- 8-12 microservice độc lập, deploy độc lập
- Service mesh (Linkerd)
- Event backbone (Redpanda) cho async
- Multi-region active-active writes (Neon multi-region hoặc move CockroachDB nếu cần)
- Self-host vLLM Llama 70B cho cost ceiling
- LiveKit cluster 4-region
- SOC2 Type 2 + HIPAA-ready

**Decision points Stage 3:**
- pgvector → Qdrant: chỉ khi vectors > 100M AND P95 search > 200ms
- Postgres → CockroachDB: chỉ khi multi-region writes thực sự cần (EU GDPR data residency hard constraint)
- Self-host LLM: chỉ khi LLM cost > $30K/month (break-even với GPU + SRE)
- Neo4j: chỉ khi concept graph > 5M nodes AND deep traversal queries > 100ms

### 2.4. Stage decision tree (kéo trigger nào để chuyển stage)

```
HIỆN TẠI?
├── Pre-PMF / < 1K MAU?
│   └─► Đừng đọc plan này. Focus product.
├── 1K - 5K MAU + revenue chưa stable?
│   └─► Stage 1 work. Tập trung §15.1 (M1-M3).
├── 5K - 50K MAU + revenue $10-100K MRR?
│   └─► Stage 2 work. Đã có team 3-5 người.
├── 50K - 500K MAU + $500K+ MRR?
│   └─► Stage 3 work. Team 10+ người, đã raise Series A.
└── > 500K MAU?
    └─► Plan v2 cần update. Có thể dùng kinh nghiệm Notion/Linear giai đoạn này.
```

### 2.5. Service decomposition rationale

**Tại sao tách service (đúng lý do):**
- ✅ Team độc lập deploy không block lẫn nhau (Conway's law)
- ✅ Scale độc lập (Chat WS-heavy, AI CPU-heavy, Ingest GPU)
- ✅ Tech stack phù hợp workload (Go cho chat, Python cho ML)
- ✅ Fault isolation (Chat down không kéo Exam down)
- ✅ Compliance boundary (Billing PCI scope tách Web app)

**Tại sao KHÔNG tách (sai lý do — anti-pattern):**
- ❌ "Microservice là best practice" — cargo cult
- ❌ "Monolith xấu" — không, monolith đúng phase OK
- ❌ "Để CV đẹp" — chính plan v1 đã có lỗi này
- ❌ "Để có distributed tracing" — distributed tracing có cho monolith
- ❌ "Để tách Postgres" — nếu chưa cần tách DB thì chưa cần tách service

**Service extraction order Cogniva (theo pain):**
1. **Notification (M7-M8)** — đầu tiên vì isolated, low-risk, ROI cao (transactional email + push không lẫn web flow)
2. **AI Service (M8-M9)** — tách vì retry/streaming logic phức tạp, model routing cần ownership riêng
3. **Chat Service (M10-M11)** — Go cho WS throughput, isolated từ web SSR
4. **Room Service (M13-M14)** — tách khi LiveKit ops phức tạp
5. **Exam Service (M14-M15)** — tách khi live exam scale > 10K concurrent
6. **Search Service (M15-M16)** — Meilisearch operator
7. **Ingest Service (M16-M17)** — Python ML team owns
8. **Analytics Service (M17-M18)** — ClickHouse + dbt pipeline

**KHÔNG tách:** Web app, Identity (auth core), Billing (đơn giản, Stripe lo nhiều)

---

## 3. Cogniva-Specific Engineering Challenges

Đây là phần plan generic không cover. Phải làm đúng vì là USP của Cogniva.

### 3.1. AI quality at scale for education

**Problem:**
- LLM hallucination trong context giáo dục = học sinh học sai → tổn hại nghiêm trọng (vs SaaS chat sai chỉ phiền).
- Vietnamese language: model phương Tây train ít VN data, quality drop 10-20% so với English.
- Multi-grade content: lớp 5 và đại học cùng prompt → cần persona/level adaptation.

**Solution stack:**

**3.1.1. Layered eval framework**
```
Layer 1: Unit eval (per LLM call)
  - Faithfulness ≥ 0.85 (RAGAS)
  - Answer relevancy ≥ 0.80
  - Context precision ≥ 0.75
  - Run mỗi PR, block deploy nếu drop > 3%

Layer 2: Curriculum eval (per subject)
  - Vietnamese: 1000 câu hỏi gold per môn (Toán, Lý, Hoá, Văn, Anh, Sử, Địa)
  - Đối chiếu sách giáo khoa SGK 2018
  - Đánh giá bởi giáo viên reviewer

Layer 3: A/B production
  - Shadow traffic 1% với model B
  - User implicit feedback (thumbs up/down, reanswer rate)
  - Adoption rate of suggested concepts

Layer 4: Adversarial
  - Red team prompt injection
  - Jailbreak resistance
  - Bias check (gender, region, ethnic)
```

**3.1.2. Multi-model routing per query class**

```
Query classification (Haiku batch):
  ├─► Factual / definitional → Sonnet + RAG (faithfulness ưu tiên)
  ├─► Reasoning / problem-solve → Opus (quality)
  ├─► Code / formula → Sonnet (specialized)
  ├─► Casual / explore → Haiku (cost)
  ├─► Vietnamese-specific → Sonnet (Anthropic VN tốt hơn Llama)
  └─► Long doc summary → Gemini 2 (context window)
```

**3.1.3. Hallucination defense in depth**
- Citation enforcement: prompt LLM trích [chunk_id], parser check
- Confidence threshold: nếu top-K chunks score < 0.6 → respond "Tôi không có tài liệu về chủ đề này"
- Disclaimer footer: "AI có thể sai, kiểm tra lại với giáo viên"
- User-flagged answers → review queue → fine-tune signal

### 3.2. Knowledge graph at scale

**Problem:** Concept graph hiện tại trong Postgres (Phase 4). Khi > 1M concepts:
- Recursive CTE traversal 3+ hops > 1s
- Đề xuất "prerequisite" cần traversal sâu
- Graph visualization client-side load chậm

**Solution stack:**

**3.2.1. Stage 2 — Postgres optimized**
- Materialized view cho 1-hop neighborhood
- Pre-compute prerequisite paths cho top 10K concepts
- Index `concept_relation(from_id, type)` + `(to_id, type)`
- BRIN index cho `created_at` (append-only)

**3.2.2. Stage 3 — Neo4j AuraDB (khi > 5M concepts)**
- Migrate concept + concept_relation → Neo4j
- Postgres giữ "ownership" — Neo4j là projection qua CDC
- Cypher cho deep traversal (Bloom filter cho cycle detect)
- Async sync via Kafka CDC stream

**3.2.3. Graph layout pre-compute**
- Dagre layout cache trong Postgres `concept_graph_cache(user_id, layout_json, version)`
- Recompute khi user thêm > 50 concepts hoặc tuần 1 lần
- Client load cached → real-time update overlay

### 3.3. Spaced repetition (FSRS) accuracy tracking

**Problem:**
- FSRS predict retention probability cho mỗi card. Predict sai → user học sai schedule → drop off.
- Cogniva-specific: cần đo per-subject accuracy (FSRS có thể tốt Toán nhưng kém Văn).

**Solution: ML observability cho FSRS**

**3.3.1. Predicted vs Actual tracking**
```
Mỗi review:
  - Log: predicted_retention (FSRS output)
  - Log: actual_outcome (user pass/fail)
  - Aggregate: Brier score per (user, subject)
  - Alert: Brier > 0.25 → FSRS param drift, cần re-tune

Dashboard:
  - Brier score time-series per subject
  - Calibration plot (predicted vs actual buckets)
  - Distribution of card states (NEW/LEARNING/REVIEW/RELEARNING)
```

**3.3.2. Personalized FSRS params**
- Default global params từ FSRS-4
- Cold start (< 100 reviews): dùng global
- Warm (> 500 reviews): tune w[19] params via gradient descent trên user history (nightly Inngest job)
- Update params nếu Brier improve > 5%

**3.3.3. Online A/B FSRS vs SM-2 (sanity check)**
- 5% user opt-in cho SM-2 baseline
- Compare retention rate at day 30
- Nếu FSRS không thắng > 10% retention → reconsider

### 3.4. Content moderation (UGC + AI outputs)

**Problem:** Room có chat + whiteboard + notes user-generated. AI tutor có thể output bậy. Cần moderation real-time + post-hoc.

**Solution stack:**

**3.4.1. Pre-publish (synchronous)**
```
User message → moderation pipeline:
  ├─► Profanity filter (VN + EN dictionary)
  ├─► PII redact (regex: email/phone/CCCD)
  ├─► Hate speech classifier (OpenAI moderation API)
  ├─► Spam detector (rate + repetition)
  └─► Block if any fail → notify user
```

**3.4.2. AI output filter (Cogniva-specific)**
```
LLM output → safety check:
  ├─► Self-harm references → block + show hotline 1800-1800
  ├─► Sexual content (ed-tech 13+) → block
  ├─► Political/religious controversy → soften prompt + retry
  ├─► Citation hallucination → flag review
  └─► PII leakage (other user's data) → audit log + revoke session
```

**3.4.3. Post-publish (async)**
- Inngest job: scan messages > 1 ngày tuổi với deeper LLM classifier
- User-flagged content → triage queue
- 3-strike system: 1st warning, 2nd 24h mute, 3rd ban
- Appeal flow + human review (T&S team từ Stage 3)

**3.4.4. Image/video moderation (rooms)**
- Cloudflare AI ImageClassifier (NSFW)
- Webcam frame sample mỗi 30s (privacy: hash-only, không lưu)
- Auto-mute camera nếu NSFW > 95% confidence

### 3.5. Exam anti-cheat at scale

**Problem:** Live exam Phase 17-19 cần anti-cheat. Plan-rooms-and-exam đã có plan, scale-up document chi tiết hơn.

**Anti-cheat stack:**

**3.5.1. Active measures (intrusive)**
- Tab focus tracker: > 5s defocus → flag
- Copy-paste disable: keyboard events bị block
- Right-click disable
- Fullscreen lock: exit fullscreen = 3-strike

**3.5.2. Passive measures (forensic)**
- Mouse movement entropy (bot detect)
- Typing rhythm fingerprint
- Webcam optional: gaze tracking (looking off-screen)
- Microphone (consent required): ambient sound check
- LLM-as-judge: answer style vs user's historical writing

**3.5.3. Statistical**
- Response time per question vs class distribution
- Answer pattern vs other students same exam (collusion)
- Score change between practice and live (sudden jump)

**3.5.4. Sociotechnical**
- Item randomization (question order + option order)
- Item pool > 3x exam size → unique exam per student
- Time pressure (15s/question vs 60s — different cognitive load)
- Honor pledge prompt before exam (psychological)

**3.5.5. Privacy compliance**
- Consent banner explicit before each measure
- Data retention: webcam frames hash-only 7 days, then delete
- Student right to opt-out (with alternative proctoring)
- FERPA: student can request exam audit log

### 3.6. Vietnamese language specifics

**3.6.1. Tokenization**
- Voyage AI tokenizer OK cho VN (verified Phase 2)
- Whisper: explicit `language: 'vi'` (default auto-detect mistakes VN ↔ Chinese)
- BM25 search: ViTokenizer (underthesea library) cho word segmentation, không dùng whitespace split

**3.6.2. OCR**
- PDF text extraction (unpdf) OK cho text PDF
- Image OCR (scan tài liệu): Tesseract `vie` traineddata + Google Cloud Vision fallback
- Math formula: MathPix API (đắt, gate sau premium tier)

**3.6.3. Font + typography**
- WOFF2 subset VN charset (50% size giảm so với full Unicode)
- System font stack: `Inter` + `Be Vietnam Pro` fallback
- Print/PDF export: embed font (license đầy đủ)

**3.6.4. Speech**
- TTS: Azure Neural VN voices (HoaiMy, NamMinh)
- STT: Whisper-large-v3 self-host hoặc OpenAI API
- Mobile native: iOS AVSpeech (built-in VN), Android TTS (cần lib)

**3.6.5. NLP edge cases**
- Đa nghĩa từ Hán Việt (đông = đông phương vs mùa đông) — context disambiguation qua LLM
- Tones (huyền/sắc/hỏi/ngã/nặng) phải normalize trước index
- Teen slang + internet writing ("ko" = "không") — pre-process trong moderation

### 3.7. Educational content compliance

**3.7.1. FERPA (US, Family Educational Rights and Privacy Act)**
- Required khi có US school enterprise customer
- Student record: confidential, parent có quyền access
- Audit log mọi truy cập student record (immutable, 5 năm retention)
- Designated school official only — RBAC strict

**3.7.2. COPPA (US, Children's Online Privacy Protection Act)**
- Required khi user < 13
- Parental consent flow trước khi tạo account
- Data minimization: chỉ collect cần thiết
- No advertising to under-13
- Data deletion request từ parent → 7 day SLA

**3.7.3. GDPR Article 8 (EU, minors)**
- Age of consent 16 (Đức), 13-16 các nước khác
- Verifiable parental consent
- Right to be forgotten (Article 17) — strict cho minor

**3.7.4. VN MOET (Bộ GD&ĐT) compliance**
- Nếu sell vào trường VN: cần đăng ký data localization
- Tài liệu SGK 2018 reference — không scrape, license đúng
- Học bạ điện tử: format chuẩn MOET nếu integrate

**3.7.5. Compliance design impact lên database**
```sql
-- User table phải có:
- age (or date_of_birth)
- parental_consent_status (NONE | PENDING | VERIFIED)
- parental_consent_at
- ferpa_eligible (boolean — institution-managed)
- gdpr_region (EU | US | APAC | OTHER)
- data_retention_until (timestamp — auto-delete trigger)

-- Mỗi student record action phải audit:
audit_log(user_id, accessor_id, action, resource, timestamp, ip, reason)
```

---

## 4. Layer 1 — Edge & Geographic

### 4.1. Multi-region strategy (revised)

**Region selection theo phase:**

| Phase | Region | Primary user base | Hosting |
|---|---|---|---|
| Stage 1 (M1-M3) | Singapore only | VN + APAC | Vercel SG + Neon US (acceptable lag) |
| Stage 1.5 (M3) | + EU (Frankfurt read replica) | EU early users | +Neon FRA replica |
| Stage 2 (M4-M12) | APAC + EU active | VN, EU schools | Vercel multi-region + Cloudflare Workers edge |
| Stage 3 (M13+) | + AMER (Virginia) | US enterprise | Active-active multi-region writes |

**Region selection logic (Stage 3):**
```
Request → Anycast DNS (Cloudflare) → nearest edge POP
       → Cloudflare Worker: 
          ├─ Auth verify (JWT)
          ├─ Rate limit (Durable Object)
          ├─ Read user.preferred_region from session
          └─ Route to origin in user's region
              (fallback: nearest healthy region)
```

**Data residency rule:**
- EU user data → must stay EU region (GDPR)
- US K-12 student data → must stay US (FERPA + state laws)
- VN user data → flexible (Phase 1: US-hosted OK, Phase 3: VN region khi có data center)
- Enterprise customer có quyền pin region (contract-specified)

### 4.2. Edge layer (Cloudflare Workers + Durable Objects)

**Move to edge (Workers):**
- ✅ JWT verify (read-only, < 5ms)
- ✅ Rate limit per IP / per user / per endpoint (Durable Objects)
- ✅ Geo-IP routing (which region origin)
- ✅ Feature flag eval (cached config)
- ✅ A/B assignment (hash user_id → variant)
- ✅ CSRF token validation
- ✅ Static API responses (cached, TTL 60s)
- ✅ Image resize (Cloudflare Images)
- ✅ Anti-bot (Turnstile challenge for suspicious)

**KHÔNG move to edge (giữ origin):**
- ❌ AI streaming (long-lived > 10s)
- ❌ DB transactions (multi-statement, need pool)
- ❌ File upload (large body)
- ❌ WebSocket signaling (LiveKit native)
- ❌ Server actions với side effect (Next.js mutation)
- ❌ Heavy compute (PDF parse, embed)

**Durable Objects use cases:**
- Rate limit counter (1 DO per user, persistent)
- Room presence (1 DO per room, in-memory + persist)
- Live exam state (1 DO per exam session, append-only events)
- Centrifugo coordination (DO as router, Stage 3)

### 4.3. CDN strategy (revised)

| Asset type | Cache TTL | Cache key | Strategy |
|---|---|---|---|
| JS/CSS (hashed) | 1 year | URL | Immutable, Brotli 11 |
| Static images | 30 days | URL + format/size | Cloudflare Images polish |
| Fonts (WOFF2) | 1 year | URL | Preload critical, woff2 subset VN |
| API responses (public) | 60s-1h | URL + Accept-Language | Stale-while-revalidate |
| API responses (user-specific) | 0 | — | No cache, Brotli 6 |
| HTML (RSC) | 60s | URL + cookie hash | ISR + revalidateTag |
| User uploads (R2) | 30 days | URL + signature | Presigned URL TTL 1h |
| AI outputs (cacheable) | 7 days | hash(prompt + model) | Custom cache for repeated questions |

**Cache invalidation patterns:**
- **Tag-based (Next.js):** `revalidateTag('user-123-docs')` on document upload
- **URL purge (Cloudflare):** API call when content change
- **Header-driven:** `Cache-Control: max-age=60, stale-while-revalidate=300`
- **Soft purge:** mark stale, regenerate on next request
- **Hard purge:** evict immediately (use for compliance: delete user data)

### 4.4. Network optimization

- **HTTP/3 (QUIC)** enabled on all origins (Cloudflare auto)
- **0-RTT TLS resumption** cho returning users (cookie warm path)
- **Brotli compression** level 6 (level 11 for static, balance CPU/size)
- **TCP_NODELAY** on sockets (Node http server tự set)
- **Connection pooling**: pgBouncer transaction mode (1000 client → 25 DB conn)
- **DNS prefetch + preconnect** critical origins (`<link rel="preconnect">`)
- **Resource hints**: prerender top likely route ("/" → "/dashboard" sau login)
- **Anycast IPs** cho mọi API endpoint (Cloudflare default)
- **Cloudflare Argo Smart Routing** ($5/mo + $0.10/GB) — 30% latency reduction global
- **Brotli streaming** cho SSE (compress per-chunk, không buffer full response)

### 4.5. Edge runtime considerations

**Cloudflare Workers limits (must design around):**
- CPU time: 50ms (free) / 30s (paid) per request
- Memory: 128MB
- Subrequests: 50 (free) / 1000 (paid)
- WebSocket: 5min idle timeout
- Outgoing connections: limited (no raw TCP)

**Implication:**
- AI streaming KHÔNG ở Workers — origin Vercel Node runtime
- Bulk file processing KHÔNG ở Workers — Inngest job
- Long polling KHÔNG ở Workers — use SSE/WS or DurableObjects

**Workers KV vs Durable Objects:**
- **KV**: eventually consistent, global replicated, TTL — cho feature flag, cached config
- **DO**: strongly consistent, single-region, transactional — cho rate limit, presence

---

## 5. Layer 2 — Data & Storage

### 5.1. Database evolution per workload

**Anti-pattern v1 đã sai:** không nên dùng 1 DB cho tất cả NHƯNG cũng không nên dùng 6 DB từ Day 1. **Evolve theo workload pain.**

#### 5.1.1. Primary OLTP — Postgres lifecycle

| Stage | Tool | Why | Cost |
|---|---|---|---|
| M1-M6 | Neon Postgres (single primary US) | Branching dev, autoscale, cheap | $50-200/mo |
| M6-M12 | Neon + 2-3 read replicas (EU, APAC) | Geo-read latency | +$100-400/mo |
| M12-M18 | Neon multi-region (preview) hoặc evaluate CockroachDB | Multi-region writes | $1-5K/mo |
| M18+ | CockroachDB Serverless | Khi đa region writes là hard constraint | $5-20K/mo |

**Khi nào KHÔNG migrate CockroachDB:**
- < 50K DAU
- Writes < 1K/s global
- EU writes < 100/s
- → Stick với Neon multi-region

**Postgres tuning Cogniva-specific:**
```
Hot tables (need most optimization):
- room_message (append-heavy) — partition by month
- review (append-heavy FSRS) — partition by month, BRIN index
- chunk (read-heavy RAG) — HNSW pgvector
- flashcard (mixed) — composite index (user_id, due)
- mastery (write-heavy on review event) — UPSERT pattern, no PK conflict

Cold tables (acceptable slow):
- audit_log — partition + move to ClickHouse > 30d
- recording — only metadata in Postgres, MP4 in R2
```

#### 5.1.2. Vector search lifecycle

| Stage | Vectors | Tool | Why |
|---|---|---|---|
| M1-M12 | 0 - 50M | pgvector HNSW | Single DB simplicity |
| M12-M18 | 50M - 200M | pgvector HNSW + partition | Postgres still fine |
| M18+ | 200M+ | Qdrant cluster | Only when proven bottleneck |

**Khi nào pgvector vẫn OK ở 200M+:**
- P95 search < 100ms (with HNSW m=16, ef_search=64)
- Filter selectivity high (per-user scope) — pgvector excels
- Hybrid query (vector + SQL filter) — pgvector wins vs Qdrant

**Khi nào MUST migrate Qdrant:**
- P95 search > 200ms sustained 2 tuần
- Filter pushdown poor (Postgres planner misjudge HNSW vs BTREE)
- Sparse vectors needed (BM25 + dense fusion)
- Multi-vector per document (Late-interaction ColBERT)

**Migration pattern pgvector → Qdrant:**
```
1. Set up Qdrant cluster (3 node minimum, replication 2)
2. Dual-write: every embed insert → both pgvector + Qdrant
3. Run shadow queries 2 weeks: log Qdrant result, serve pgvector
4. Compare result sets — recall@10 should be > 95% match
5. Switch read traffic 1% → 10% → 50% → 100% over 1 week
6. Decommission pgvector after 2 weeks stable
```

#### 5.1.3. OLAP / Analytics — ClickHouse

**Khi nào setup ClickHouse:**
- M6-M9 (Stage 2 mid)
- Trigger: > 1M event/day, dashboard query > 5s on Postgres

**Use cases:**
- User behavior events (replace PostHog free tier)
- AI usage analytics (per-user cost tracking)
- Mastery model accuracy time-series
- A/B test result aggregation
- Performance metrics (1-min rollup)

**Schema pattern:**
```sql
CREATE TABLE events (
  event_time DateTime64(3),
  user_id String,
  event_name String,
  properties Map(String, String),
  -- denormalized for query speed
  org_id String,
  region String,
  app_version String
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(event_time)
ORDER BY (user_id, event_time)
TTL event_time + INTERVAL 2 YEAR;
```

**Pipeline:** App → Inngest → batch insert ClickHouse (1000 row/batch, 5s flush).

**Don't:** Real-time INSERT mỗi event vào ClickHouse — sai pattern. ClickHouse là batch-oriented.

#### 5.1.4. Cache layer evolution

| Stage | Tool | Why |
|---|---|---|
| M1-M6 | Upstash Redis (serverless) | $0.20/100K commands, no ops |
| M6-M12 | + Cloudflare Workers KV (edge cache) | Global replicated read |
| M12+ | DragonflyDB self-host (Hetzner) | 25x Redis throughput, $200/mo for 32GB |

**Cache hierarchy (4 layer Cogniva):**
```
L1: Browser (HTTP cache + IndexedDB for static data)
L2: Cloudflare CDN edge (60s for public, 0 for user)
L3: Workers KV (global config, feature flags)
L4: Redis/Dragonfly (app-level cache, session, hot data)
L5: Postgres (source of truth)
```

**Cache key patterns:**
```
- user:{id}:profile          TTL 5min
- doc:{id}:chunks:hash       TTL 1day (immutable content)
- rag:query:{hash}           TTL 5min (semantic cache)
- mastery:{user}:{concept}   TTL 1min (write-through)
- room:{id}:participants     TTL 30s (presence)
- ai:cost:{user}:{day}       TTL 24h (quota counter)
```

**Cache invalidation strategy:**
- **Write-through:** mastery update → write cache + DB cùng lúc
- **Cache-aside:** read miss → DB → fill cache
- **TTL-only:** ephemeral data (presence)
- **Event-driven:** doc upload → publish event → invalidate via Kafka consumer

### 5.2. Object storage tiers (R2)

**Bucket structure:**
```
cogniva-documents/           — user uploads (PDF, images)
  {user_id}/{doc_id}.pdf
cogniva-recordings/          — LiveKit egress
  {room_id}/{timestamp}.mp4
  {room_id}/{timestamp}.transcript.json
cogniva-generated/           — AI outputs, exports
  exports/{user_id}/{job_id}.pdf
  flashcard-decks/{deck_id}.json
cogniva-backups/             — DB snapshots
  postgres/daily/{date}.dump
  postgres/wal/{lsn}.wal
cogniva-static-assets/       — CDN-fronted
  fonts/, images/, logos/
cogniva-audit-archive/       — compliance (immutable)
  audit-log/{date}.parquet
```

**Lifecycle policies:**
| Bucket | Rule |
|---|---|
| documents | No auto-delete (user-owned). GDPR delete on request. |
| recordings | Tier to cold class after 90 days. Delete after 365 days (or user delete). |
| generated | Delete after 30 days (regenerate-able). |
| backups | Cross-region replicate. Daily → 30d keep. Weekly → 1y. Monthly → 7y. |
| audit-archive | Immutable, 7 year retention (FERPA/SOC2). |

**Access patterns:**
- Documents: presigned URL TTL 1h (user-owned read), TTL 5min upload
- Recordings: presigned URL TTL 1h (members of room only)
- Generated: presigned URL TTL 24h (one-time download)
- Static: public, CDN-fronted, signed URL not needed
- Audit: NO presigned. Direct S3 API from compliance officer only.

### 5.3. Search infrastructure

**Stage 1-2: Postgres only**
- BM25 via pg_trgm + ts_vector (built-in)
- Khoảng 70-80% recall đối với vanilla search
- Hybrid với pgvector → 90%+ recall

**Stage 3: Meilisearch (khi cần)**
- Trigger: full-text search latency > 200ms, hoặc cần typo tolerance VN
- Meilisearch self-host trên Hetzner ($40/mo cho 50M docs)
- Sync qua CDC (Postgres LISTEN/NOTIFY → consumer → Meilisearch upsert)

**Use cases:**
- Flashcard search trong deck (typo tolerance: "lim" find "limit")
- Document search (full-text + filename)
- Concept search trong knowledge graph
- Chat history search

**KHÔNG dùng Elasticsearch:** ops overhead cao, Meilisearch đủ cho scale Cogniva.

### 5.4. Time-series — TimescaleDB

**Khi nào:** M9+ khi metrics aggregation > 10M points/day

**Use cases:**
- Performance metrics (P95 latency 1-min rollup)
- Mastery score time-series per user
- AI cost time-series
- Concurrent user gauge

**Architecture:**
- TimescaleDB extension trên Postgres riêng (không cùng OLTP — avoid noisy neighbor)
- Hypertable partition by `time` (7-day chunks)
- Continuous aggregates: 1-min → 1-hour → 1-day rollup
- Retention: raw 30 days, hourly 1 year, daily 7 years

### 5.5. Knowledge graph storage

**Stage 1-2: Postgres (current)**
- `concept` + `concept_relation` tables
- Recursive CTE cho traversal
- Materialized view cho hot queries

**Stage 3: Neo4j AuraDB (khi > 5M concepts)**
- Migrate qua CDC
- Postgres giữ ownership, Neo4j là projection
- Cypher cho deep traversal
- Neo4j Bloom cho visualization

**Migration trigger:**
- Concept count > 5M
- 3-hop traversal P95 > 500ms
- Path query > 100ms unacceptable

### 5.6. Data flow patterns

#### 5.6.1. CQRS (Command Query Responsibility Segregation)

**Write path:**
```
Client → API → Validate → Service → Postgres primary
                                  → Publish event (Kafka/Inngest)
                                       ├→ ClickHouse sink (analytics)
                                       ├→ Search index update
                                       ├→ Cache invalidate
                                       └→ Webhook dispatch
```

**Read path:**
```
Client → API → Cache (Dragonfly) miss?
              → Postgres replica (region-local)
              → Hot reads pre-aggregated in cache
```

#### 5.6.2. Event sourcing (Exam system only)

**Mọi exam action → append-only event:**
```
event: exam.question.answered
data: { exam_id, user_id, question_id, answer, time_taken, timestamp }
```

**Benefits:**
- Replay any exam state at any time (audit, dispute)
- Re-grade after rubric update without losing data
- ML training data ready (event log = training set)

**Storage:**
- Postgres `exam_event` table (append-only, BRIN index on timestamp)
- Project to `exam_state` materialized view
- Archive to ClickHouse after exam end + 30 days

#### 5.6.3. Change Data Capture (CDC)

**Pattern (Stage 3):**
```
Postgres WAL → Debezium → Kafka topics:
  - cdc.public.flashcard
  - cdc.public.mastery
  - cdc.public.room_message
                ↓
        Consumers:
          ├→ Meilisearch index
          ├→ ClickHouse analytics
          ├→ Cache invalidation
          ├→ Neo4j projection
          └→ Audit log archive
```

**Latency:** end-to-end < 5s. Acceptable cho all non-critical paths.

### 5.7. Indexing strategy (concrete)

**Audit weekly:** `pg_stat_statements` để tìm slow queries (> 100ms P95).

**Index patterns Cogniva:**

```sql
-- Flashcard daily review queue (hot)
CREATE INDEX flashcard_user_due_idx ON flashcard(user_id, due) 
WHERE state IN ('NEW', 'LEARNING', 'REVIEW');  -- partial index

-- Chat history paginate
CREATE INDEX room_message_room_time_idx ON room_message(room_id, created_at DESC);

-- Concept search by user + name
CREATE INDEX concept_user_name_trgm_idx ON concept 
USING gin(name gin_trgm_ops) 
WHERE user_id IS NOT NULL;

-- Mastery hot path
CREATE INDEX mastery_user_concept_idx ON mastery(user_id, concept_id);

-- pgvector HNSW
CREATE INDEX chunk_embedding_hnsw_idx ON chunk 
USING hnsw (embedding vector_cosine_ops) 
WITH (m = 16, ef_construction = 64);

-- Audit log BRIN (append-only)
CREATE INDEX audit_log_time_brin_idx ON audit_log USING brin(timestamp);

-- JSONB GIN cho features toggle
CREATE INDEX room_features_gin_idx ON room USING gin(features);
```

**Anti-patterns to avoid:**
- ❌ Over-indexing: 1 table > 10 indexes → write slowdown
- ❌ Redundant indexes: `(a)`, `(a,b)` — `(a)` redundant if always paired
- ❌ Low-cardinality column index: `state ∈ {NEW, REVIEW}` — partial OK, full bad

### 5.8. Backup & disaster recovery

**Backup tiers:**
1. **Continuous (PITR):** Neon native, 30 days retention
2. **Daily snapshot:** Neon → R2 → Backblaze B2 (cold)
3. **Logical dump weekly:** pg_dump → R2 (cross-region replicate)
4. **Audit log:** Kafka → S3 Glacier, 7 năm immutable

**RTO/RPO targets:**

| Scenario | RTO | RPO | Strategy |
|---|---|---|---|
| Single AZ failure | < 5min | 0 | Auto-failover Neon |
| Region failure | < 30min | < 5min | Promote replica + DNS switch |
| Accidental delete table | < 1h | < 5min | PITR restore to staging, copy back |
| Whole DB corruption | < 4h | < 1h | Logical dump restore |
| Ransomware/encryption attack | < 24h | < 24h | Cold backup B2, immutable |

**DR drill schedule (mandatory):**
- Monthly: PITR restore staging (15 min job)
- Quarterly: Region failover simulation (planned downtime window)
- Semi-annually: Full DB restore from cold backup (test backups actually work)
- Annually: Cross-region active-active failover test

**Common mistake to avoid:**
- "Backup chạy" KHÔNG có nghĩa "restore được"
- "Restore staging" KHÔNG có nghĩa "restore production tốc độ chấp nhận được"
- Tested backup is the only real backup.

### 5.9. GDPR delete & data lineage

**Right to erasure (Article 17) implementation:**
```
User request delete:
  1. API: POST /api/account/delete (require password reauth)
  2. Inngest job: delete-user-data
     ├─ Postgres: cascade delete user → docs, chunks, flashcards, etc.
     ├─ R2: delete all objects with prefix {user_id}/
     ├─ ClickHouse: scrub events (anonymize user_id, keep aggregates)
     ├─ Qdrant: delete points where payload.user_id = X
     ├─ Search: delete from Meilisearch
     ├─ Cache: invalidate all keys user:{id}:*
     ├─ Audit log: KEEP (legal requirement) but redact PII fields
     └─ Backup: cannot delete from cold storage immediately
  3. 30-day grace: undo possible
  4. After 30 days: cryptoshred (delete encryption key if field-encrypted)
  5. Compliance report: log deletion completion
```

**Data lineage tracking:**
- Mọi PII field tagged in schema (`-- @pii`)
- Mỗi service track data origin in audit_log
- Lineage graph: which service touched data when
- Tool: OpenLineage or DIY with Postgres

---

## 6. Layer 3 — Compute & Runtime

### 6.1. Hosting decision matrix

**Workload to platform mapping (revised):**

| Workload | Stage 1 (M1-M3) | Stage 2 (M4-M12) | Stage 3 (M13+) | Rationale |
|---|---|---|---|---|
| Frontend SSR | Vercel | Vercel multi-region | Vercel + edge | Best Next.js support |
| Edge logic | (none) | Cloudflare Workers | Cloudflare Workers | 300+ POPs, low latency |
| API routes | Vercel functions | Vercel + Fly.io (long-lived) | Fly.io primary | Vercel 10min timeout limit |
| Background jobs | Inngest Cloud | Inngest Cloud | Inngest Cloud + self-host runner | Managed, observable |
| Realtime (WS) | Soketi Hetzner | Centrifugo Hetzner cluster | Centrifugo multi-region | Self-host for control + cost |
| WebRTC SFU | LiveKit Hetzner (1 node) | LiveKit cluster 2-region | LiveKit cluster 4-region | Self-host bandwidth |
| Heavy compute (ingest) | Inngest function | Hetzner dedicated bare metal | Hetzner + autoscale | CPU cost predictable |
| GPU workloads | (cloud LLM only) | Modal/RunPod spot GPUs | Modal/RunPod + reserved | Pay-per-second flexibility |
| Database OLTP | Neon serverless | Neon multi-region | Neon multi-region | Postgres-compat, branching |
| Vector DB | pgvector (in Neon) | pgvector (in Neon) | Qdrant Cloud | Only if needed |
| Cache | Upstash Redis | Upstash + Workers KV | DragonflyDB self-host | Cost ceiling at scale |
| Analytics DB | (none) | ClickHouse Cloud | ClickHouse Cloud | Best for OLAP |

**Avoid:**
- AWS EC2 raw — too low-level, no value-add for stage Cogniva
- GCP — no obvious advantage vs Vercel + Hetzner
- Heroku — outdated, costly
- Kubernetes (own) trước Stage 3 — ops nightmare

### 6.2. Runtime tiers (per service)

**Tier 1 — Low latency Go services (Stage 2+):**
- Chat service (WS heavy, mostly sync I/O)
- Exam service (live exam state machine)
- Room service (LiveKit signaling proxy)
- Latency target: < 10ms internal
- Deploy: Fly.io machines, multi-region

**Tier 2 — Node.js / TypeScript:**
- Web app (Next.js)
- AI service (Mastra agents)
- Notification service (transactional)
- Latency target: < 50ms internal
- Deploy: Vercel (web) + Fly.io (services)

**Tier 3 — Python (Stage 2-3):**
- Ingest service (OCR, parsing, embedding pre-compute)
- ML training data prep
- Deploy: Hetzner dedicated (bare metal Ryzen + 64-128GB RAM)
- Why bare metal: predictable cost, GPU optional, no cold start

**Tier 4 — Rust (Stage 3+, only if proven):**
- Analytics ingestion (1M+ events/s)
- Real-time aggregation
- Anti-cheat fingerprint matching
- Only when Node.js measured bottleneck

### 6.3. Container & orchestration evolution

| Stage | Orchestration | Why | Effort |
|---|---|---|---|
| M1-M3 | Vercel + Fly.io built-in | Zero ops | 0% engineer time |
| M4-M9 | Fly.io machines + Docker compose Hetzner | Mid-complexity | < 5% time |
| M9-M15 | Nomad (HashiCorp) | Lightweight, single binary | 10-15% time |
| M15+ | Kubernetes (EKS or GKE) | Khi > 30 services | 25-30% time (full SRE) |

**Don't:**
- ❌ K8s tự host (kops, kubeadm) — chỉ AWS/GCP managed
- ❌ Mesos / DC/OS — dying ecosystem
- ❌ Docker Swarm — dead

**Container best practices:**
- Multi-stage Dockerfile (build → runtime)
- Distroless or Alpine base
- Non-root user (UID 1000+)
- Read-only filesystem (mount tmpfs for /tmp)
- Healthcheck endpoint (`/health` returns 200)
- Graceful shutdown handler (SIGTERM → drain connections 30s)

### 6.4. Service mesh (Stage 3+, KHÔNG SỚM HƠN)

**Linkerd > Istio for Cogniva:**
- Linkerd: lightweight, Rust data plane, < 1ms overhead
- Istio: feature-rich but complex, 2-5ms overhead
- Cogniva size doesn't need Istio's enterprise features

**When to add mesh:**
- 15+ services
- Need: mTLS automatic, distributed tracing standard, circuit breaker default
- Have: dedicated SRE
- Don't have: time to implement these manually per service

**Mesh features used:**
- mTLS between services
- Retry + timeout policies
- Circuit breakers
- Distributed tracing injection
- Traffic splitting (canary deployments)
- Observability dashboard

### 6.5. Deployment strategy

**Branch model: trunk-based**
- Main always deployable
- Short-lived feature branches (max 3 days)
- Feature flag for in-progress work
- No long-running release branches

**Pipeline (GitHub Actions):**
```
Push to PR:
  ├─ Lint (eslint, biome)
  ├─ Typecheck (tsc)
  ├─ Unit tests (vitest)
  ├─ Build (next build)
  └─ Preview deploy (Vercel preview URL)

Merge to main:
  ├─ Full test suite (E2E playwright)
  ├─ Security scan (Snyk, Trivy)
  ├─ Build container images
  ├─ Deploy to staging (auto)
  ├─ Smoke tests staging
  ├─ Canary deploy production 1% (manual approval Stage 2+)
  ├─ Wait 15min, check SLO
  ├─ Roll forward 10% → 50% → 100% (auto if SLO OK)
  └─ Notify Slack
```

**Canary criteria:**
- Error rate increase < 0.5%
- P95 latency increase < 10%
- No new Sentry critical alerts
- AI eval score not dropped > 3%

**Rollback triggers (auto):**
- Any criterion fails
- Manual: Slack `/rollback` slash command
- Max time to rollback: < 5 minutes

### 6.6. Feature flag system (CRITICAL — Phase 1 must-have)

**Tool choice:**
- **Stage 1**: PostHog feature flags (free up to 1M evaluations/mo)
- **Stage 2-3**: LaunchDarkly hoặc Statsig (when need targeting + analytics + experimentation)

**Flag types:**
- **Release flag**: toggle new feature on/off (kill switch)
- **Experiment flag**: A/B variant assignment
- **Permission flag**: feature gate per plan (free/pro/team)
- **Operational flag**: degradation modes (disable AI when overloaded)

**Naming convention:**
```
release.{feature_name}      e.g. release.exam_v2_ui
experiment.{exp_name}       e.g. experiment.fsrs_personalized
permission.{plan}.{feature} e.g. permission.pro.unlimited_ai
ops.degradation.{service}   e.g. ops.degradation.ai_disabled
```

**Best practices:**
- Every new feature behind flag
- Default flag OFF in code, server-driven ON
- Cleanup flags after 30 days stable
- Flag-fatigue monitoring (> 100 active flags = problem)
- Targeting: by user_id, by plan, by region, by % rollout

### 6.7. Database migration tooling

**Tool: Drizzle Kit (current) + custom scripts**

**Migration types:**

| Type | Pattern | Risk |
|---|---|---|
| Add column nullable | Single statement, online | Low |
| Add column with default | `ALTER ADD ... DEFAULT NULL` then backfill | Medium |
| Drop column | Multi-step: stop writes → backfill → drop | High |
| Rename column | Add new + dual-write + cutover + drop | High |
| Add index | `CREATE INDEX CONCURRENTLY` | Low |
| Drop index | Online | Low |
| Add NOT NULL | Add column nullable → backfill → set NOT NULL | High |
| Change type | Add new column → backfill → swap | High |

**Online migration framework:**
```typescript
// scripts/migrations/20260601-add-user-region.ts
export const migration = {
  up: async (db) => {
    // Step 1: add nullable column
    await db.execute(sql`ALTER TABLE user ADD COLUMN region TEXT NULL`);
    
    // Step 2: backfill in batches (avoid table lock)
    let offset = 0;
    const batchSize = 1000;
    while (true) {
      const updated = await db.execute(sql`
        UPDATE user SET region = 'APAC' 
        WHERE id IN (
          SELECT id FROM user WHERE region IS NULL LIMIT ${batchSize}
        )
      `);
      if (updated.rowCount === 0) break;
      offset += batchSize;
      await sleep(100); // avoid replica lag
    }
    
    // Step 3: deferred — set NOT NULL in next deploy after code reads region
  },
  down: async (db) => {
    await db.execute(sql`ALTER TABLE user DROP COLUMN region`);
  }
};
```

**Tooling rules:**
- Migration must be **online** (no exclusive lock on hot tables)
- Migration must be **reversible** (or has tested forward-only justification)
- Migration must be **idempotent** (re-run safe)
- Migration test on staging copy of prod data before main

---

## 7. Layer 4 — Real-time & Streaming

### 7.1. WebSocket infrastructure evolution (revised)

**Stage 1: Soketi self-host (CURRENT, KEEP)**
- 2 replica + Redis adapter
- Capacity: **~100K WS conn/node** (verified Soketi benchmarks, not 10K as v1 said)
- Cost: $20/mo Hetzner CX21
- Total capacity: ~200K conn — enough for Stage 1+2

**Stage 2 transition triggers (NOT default):**
- WS conn > 150K sustained
- Pusher protocol limits encountered
- Need: gRPC client, multi-protocol

**Stage 2+ Option A: Soketi horizontal scale**
- 4-8 replicas behind Caddy sticky session
- Capacity: 500K+ conn
- Stay if no feature blockers

**Stage 2+ Option B: Centrifugo migration**
- Go-based, 1M+ conn/node demonstrated
- gRPC, SSE, WS multi-protocol
- Better presence, history APIs
- Migrate ONLY if Soketi can't scale OR need features

**Architecture Stage 3:**
```
Users → Cloudflare → Sticky LB → Centrifugo cluster (4 regions)
                                      ├→ Redis pub/sub (Dragonfly)
                                      └→ Backend services (API auth)
```

### 7.2. CRDT collaboration evolution

**Stage 1-2: Hocuspocus self-host (CURRENT)**
- Single instance, OK to 5K concurrent edit users
- Per-room state in-memory + Postgres `collab_doc` persist

**Stage 2+ migration trigger:**
- > 5K concurrent CRDT users
- Need multi-region failover for CRDT state

**Stage 2+ Option A: y-redis (self-host)**
```
Hocuspocus nodes (stateless) → y-redis (Redis-backed CRDT state)
  ├─ Multiple nodes share state
  ├─ Failover automatic
  └─ Persist snapshots → Postgres
```

**Stage 2+ Option B: Liveblocks managed**
- $0.50/MAU after 100 users
- Zero ops
- Better presence + threads features
- Lock-in concern

**Decision:** Stage 2 default Option A (cost). Switch B if presence quality matters AND team < 5.

### 7.3. WebRTC infrastructure (LiveKit cluster)

**Stage 1: Single LiveKit Hetzner**
- 1 node, capacity ~50 concurrent participants per room
- Total ~200 concurrent participants across all rooms
- Cost: $40/mo

**Stage 2: 2-region cluster (SG + FRA)**
- Cascading SFU between regions
- Auto-route by region
- ~500 concurrent participants per region

**Stage 3: 4-region cluster**
- SG + TY + FRA + IAD
- Full cascading mesh
- ~2K concurrent per region

**Cascading architecture (Stage 2+):**
```
User VN ──► SG SFU ──┐
                     │
User JP ──► TY SFU ──┤── cascade mesh
                     │
User DE ──► FRA SFU ─┤
                     │
User US ──► IAD SFU ─┘

Each pair of SFUs connect via dedicated transit
Audio prioritized, video sub-sampled cross-region
```

**Optimizations:**
- Simulcast 3 layers (180p/360p/720p)
- Adaptive bitrate via network probing
- Selective subscription (only video for visible participants)
- Audio-only fallback automatic when network < 200kbps
- Server-side echo cancellation option (less client CPU)
- AV1 codec progressive rollout (Stage 3, when browser support > 80%)
- VP9 default, H.264 fallback

**TURN servers:**
- coturn cluster mỗi region
- Multi-ISP redundancy (Hetzner + OVH)
- Bandwidth: 1Gbps unmetered (Hetzner CCX, $30/mo)

### 7.4. SSE strategy (REVISED — use more, WS less)

**Use SSE instead of WS for:**
- AI token streaming (uni-directional, HTTP/2 multiplex friendly)
- Notification feed (read-only)
- Progress updates (job status)
- Live exam leaderboard
- Real-time analytics dashboard

**Why SSE > WS for these:**
- HTTP/2 connection coalescing (1 conn serves many SSE)
- Built-in auto-reconnect
- Firewall friendly (just HTTP)
- Lighter (no frame overhead)
- Works with edge cache

**Keep WS for:**
- Chat (bidirectional)
- Collab CRDT (bidirectional + binary)
- WebRTC signaling
- Mod actions broadcast

**SSE implementation Cogniva:**
```typescript
// API route: AI streaming via SSE thay vì Soketi
export async function GET(req: Request) {
  const stream = new ReadableStream({
    async start(controller) {
      for await (const chunk of aiStream) {
        controller.enqueue(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      controller.close();
    }
  });
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}
```

### 7.5. Event streaming backbone (Stage 3)

**Tool: Redpanda (Kafka-compatible, Go-based)**

**Why Redpanda > Kafka:**
- Single Go binary, no Zookeeper
- 6x lower latency
- 10x simpler ops
- 100% Kafka API compatible

**Topics structure:**
```
events.user.*           - user actions
events.exam.*           - exam lifecycle  
events.room.*           - room events
events.ai.*             - AI calls (cost, latency tracking)
events.flashcard.*      - review events (FSRS training data)
audit.security          - security events (compliance)
audit.compliance        - GDPR/FERPA actions
analytics.*             - to ClickHouse
cdc.public.*            - DB changes via Debezium
notifications.*         - notification dispatch queue
ml.training.*           - ML training data pipeline
```

**Consumers:**
- ClickHouse sink (analytics)
- Audit archive (S3 immutable)
- Real-time dashboards (Grafana streams)
- Notification dispatcher
- ML training data pipeline
- Search index updater
- Webhook external (Zapier-like)

**Retention:**
- Hot: 7 days local disk
- Warm: 30 days S3 tiered storage (Redpanda Tiered)
- Cold: archive to Glacier after 90 days

### 7.6. Push notification infrastructure

**Stage 1-2: One-Signal hoặc Knock**
- Knock: $99/mo for 10K users, transactional notification dispatcher
- OneSignal: free up to 10K subs, mobile + web push

**Stage 3: Self-host (Stage 3, if scale)**
- Custom dispatcher via Inngest/Redpanda
- FCM (Firebase) for Android
- APNs (Apple) for iOS
- Web Push API for browsers

**Cogniva notification types:**
- Transactional: signup confirm, password reset, billing
- Lifecycle: streak reminder, weekly review summary
- Social: room invite, mention in chat, exam result
- Marketing: feature announcement (opt-in only)

**Delivery channels:**
- Email (SendGrid → Postmark backup)
- Push (FCM + APNs)
- In-app (Realtime via SSE)
- SMS (Twilio — only for critical: 2FA, payment failure)

**Preferences UX:**
- User dashboard `/settings/notifications`
- Granular per type + per channel
- Daily/weekly digest options
- Quiet hours per timezone
- One-click unsubscribe (CAN-SPAM compliance)

---

## 8. Layer 5 — AI/ML Infrastructure

### 8.1. Multi-provider LLM routing

**Provider matrix (Cogniva 2026):**

| Provider | Model | Use case | TTFT | Cost (in/out per M tok) | SLA |
|---|---|---|---|---|---|
| Anthropic | Sonnet 4.6 | Chat default, RAG, code | 600-1500ms | $3 / $15 | 99.9% |
| Anthropic | Opus 4.7 | Reasoning, hard exam grading | 1000-2500ms | $15 / $75 | 99.9% |
| Anthropic | Haiku 4.5 | Classification, batch | 200-500ms | $0.80 / $4 | 99.9% |
| OpenAI | GPT-5 | Fallback Sonnet | 800-1800ms | $5 / $20 | 99.9% |
| Groq | Llama 3.3 70B | Real-time, voice | 100-300ms | $0.59 / $0.79 | 99% |
| DeepSeek | V3 | Cost-sensitive batch | 800-2000ms | $0.27 / $1.10 | 95% |
| Google | Gemini 2 Pro | Long context (1M tok) | 1500-3000ms | $1.25 / $5 | 99.5% |
| Self-host | Llama 3.3 70B vLLM | Cost ceiling (Stage 3) | 400-800ms | $0 marginal + GPU | per ops |

**Routing logic Cogniva (use-case based):**

| Use case | Primary | Fallback | Why |
|---|---|---|---|
| RAG chat answer | Sonnet | GPT-5 | Best faithfulness |
| Reasoning (multi-step math) | Opus | Sonnet | Quality > cost |
| Concept extraction | Haiku | Self-host Llama | Batch, cost-sensitive |
| Chunk metadata | Haiku batch | DeepSeek | Volume + cost |
| Flashcard generation | Sonnet | GPT-5 | Quality matter |
| Exam grading (short answer) | Sonnet + Opus disagree | Human review | Critical correctness |
| Live AI tutor (room) | Haiku stream | Sonnet | Latency > depth |
| Voice STT | Groq + Whisper | OpenAI Whisper | Latency |
| Voice TTS | Azure VN | ElevenLabs | Vietnamese quality |
| Translation | Sonnet | Gemini | Context handling |
| Long doc summary | Gemini 2 | Sonnet chunked | Context window |
| Image OCR + analyze | Sonnet vision | GPT-4o | Quality |

**Implementation: LLM gateway service (Stage 2)**

```typescript
// apps/web/src/lib/ai/router.ts
type Route = {
  primary: ProviderModel;
  fallback: ProviderModel[];
  budget: { maxCostUsd: number; maxLatencyMs: number };
  cache: { ttl: number; semantic: boolean };
  evalGate: { faithfulness: number; relevancy: number };
};

const ROUTES: Record<UseCase, Route> = {
  ragChat: {
    primary: { provider: 'anthropic', model: 'sonnet-4-6' },
    fallback: [
      { provider: 'openai', model: 'gpt-5' },
      { provider: 'self-host', model: 'llama-3.3-70b' }
    ],
    budget: { maxCostUsd: 0.10, maxLatencyMs: 30_000 },
    cache: { ttl: 300, semantic: true },
    evalGate: { faithfulness: 0.85, relevancy: 0.80 }
  },
  // ... more routes
};
```

**Circuit breaker per provider:**
- Open after 5 consecutive failures
- Half-open test after 30s
- Auto-fallback to next provider in chain
- Notify Sentry on circuit open

**Cost guardrails:**
- Per-user daily limit (free: $0.50, pro: $5.00, team: $50.00)
- Per-request hard cap ($1.00, prevent runaway)
- Cost circuit breaker: total $/hour exceeds threshold → disable expensive routes
- Alert at 80% budget burn

### 8.2. RAG production stack (Stage 2-3)

**Ingestion pipeline:**
```
Upload → R2 (raw file)
       → Inngest queue
       → Worker pool:
          ├→ Parse (unpdf for PDF, Tesseract for image, etc.)
          ├→ Smart chunking (semantic, not fixed-size):
          │   ├─ Split by heading
          │   ├─ Detect topic shift (cosine drop > 0.3)
          │   └─ Merge < 100-token fragments
          ├→ Metadata extraction (Haiku batch):
          │   ├─ Subject classifier
          │   ├─ Difficulty estimate
          │   ├─ Keywords/concepts
          │   └─ Grade level estimate
          ├→ Embed (Voyage 3 primary, BGE-M3 self-host fallback):
          │   ├─ Batch 100 chunks/request
          │   └─ Cache forever (immutable content)
          ├→ Upsert vector DB (pgvector or Qdrant)
          ├→ Concept extract → knowledge graph
          ├→ Flashcard auto-gen (Sonnet, async)
          └→ ClickHouse event log
```

**Retrieval pipeline (Phase 3 advanced):**
```
Query
  ├→ Query classification (Haiku):
  │   ├─ Type: factual | conceptual | procedural | comparative
  │   └─ Subject hint
  ├→ HyDE expansion (Haiku): generate hypothetical answer
  ├→ Hybrid search parallel:
  │   ├→ Dense vector (Qdrant/pgvector) topK=20
  │   └→ BM25 (Postgres tsvector or Meilisearch) topK=20
  ├→ Reciprocal Rank Fusion (k=60)
  ├→ Cohere rerank-3.5 (or self-host BGE-reranker-v2)
  ├→ MMR diversity filter (lambda=0.7)
  ├→ Context assembly:
  │   ├─ Top-K chunks
  │   ├─ User profile (weak topics for grounding)
  │   ├─ Conversation history (last 10 msg)
  │   └─ Mastery state (don't re-teach mastered)
  ├→ Prompt caching (Anthropic) cho system prompt + chunks
  └→ Stream to LLM
```

**Caching aggressive:**
- **Embedding cache**: forever, hash(content). Saves $$$ on re-process.
- **Prompt cache (Anthropic)**: 90% cost reduction for repeated system prompt
- **Retrieval cache**: 5min TTL on hash(normalized_query). For repeated questions.
- **Semantic cache**: separate, embedding similarity > 0.95 → reuse answer

**Speculative retrieval (Stage 3):**
- While user types, predict likely next query via Markov chain on recent
- Pre-fetch top chunks for predicted queries
- 200ms perceived latency reduction

### 8.3. AI evaluation framework (Cogniva-specific)

**This is the MOST important AI infra investment. Without eval, you fly blind.**

#### 8.3.1. Golden dataset structure

```
evals/
  golden/
    rag-chat/
      ├─ factual-vn.jsonl       (200 examples)
      ├─ conceptual-vn.jsonl    (200)
      ├─ procedural-vn.jsonl    (200)
      └─ comparative-vn.jsonl   (200)
    flashcard-gen/
      ├─ cloze-quality.jsonl    (100)
      └─ basic-quality.jsonl    (100)
    exam-grading/
      ├─ short-answer-vn.jsonl  (200 with rubric)
      └─ math-step-grade.jsonl  (100)
    safety/
      ├─ adversarial.jsonl      (50 jailbreak attempts)
      ├─ pii-leak.jsonl         (50 PII protection)
      └─ bias.jsonl             (50 fairness checks)
    moderation/
      ├─ profanity-vn.jsonl     (100)
      └─ self-harm.jsonl        (50 with hotline expected)
```

#### 8.3.2. Eval metrics

**Per RAG call:**
- Faithfulness (RAGAS): % of claims supported by retrieved context
- Answer relevancy: how well answer addresses question
- Context precision: ratio of relevant chunks retrieved
- Context recall: % of needed info retrieved
- Citation accuracy: cited chunks actually contain claim

**Per generation task:**
- BLEU/ROUGE for known-answer comparison
- LLM-as-judge for subjective (use Opus as judge to grade Sonnet/Haiku outputs)
- Human eval sample (5% weekly)

**Production telemetry (RAGAS shadowed):**
- Sample 1% production traffic for eval
- Async eval in Inngest (don't block user)
- Per-day P95 metric per route
- Alert on drop > 5%

#### 8.3.3. Eval automation

```yaml
# .github/workflows/ai-eval.yml
on:
  pull_request:
    paths:
      - 'src/lib/ai/**'
      - 'src/mastra/**'
      - 'evals/**'

jobs:
  eval:
    steps:
      - run: pnpm eval:golden
      - run: |
          # Compare PR branch vs main baseline
          DROP=$(node scripts/eval-compare.js)
          if [ $DROP -gt 3 ]; then
            echo "::error::AI eval dropped by ${DROP}% — block deploy"
            exit 1
          fi
      - uses: actions/upload-artifact@v4
        with:
          name: eval-report
          path: eval-results.json
```

#### 8.3.4. Continuous eval in production

- Sample 1% production requests
- Async eval job (Inngest):
  1. Re-run query with eval rubric
  2. Store result in ClickHouse
  3. Dashboard: faithfulness P95 per day per route
- Alert: if 7-day rolling P95 drops > 10% vs baseline → page on-call
- Monthly eval review: tune prompts, swap models, update golden

### 8.4. Self-host inference (Stage 3+)

**Break-even math:**
```
Anthropic Sonnet: $3 input + $15 output per 1M tokens
Self-host Llama 3.3 70B on A100 80GB:
  - GPU cost: $1.50/hour (Modal/RunPod spot)
  - Throughput: ~30 tokens/sec/user, 10 concurrent users
  - Cost per 1M tokens (output): $1.50 * 3600s / (30 * 60 * 10) ≈ $0.30
  - Save vs Sonnet: 95% on output, 90% on input
  - Break-even: $10K/mo LLM spend pays for 2x A100 + ops
```

**When to self-host:**
- LLM bill > $10K/month sustained 2 months
- Use case is **batch** or **lower-quality acceptable** (chunking, classification)
- Engineering capacity: 1 SRE + 1 ML eng

**vLLM stack:**
- vLLM for serving (PagedAttention, continuous batching)
- Model: Llama 3.3 70B Instruct (or DeepSeek R1 distill 32B if reasoning)
- Quantization: AWQ INT4 (preserves quality, 4x throughput)
- Optimization: speculative decoding với draft model 7B
- Multi-tenant prefix caching (shared system prompts)

**Route low-priority to self-host:**
- Chunking metadata extraction
- Concept extraction
- Simple classification
- Daily/weekly summary digests

**Keep high-priority on Anthropic/OpenAI:**
- User-facing chat
- Exam grading
- Critical reasoning

### 8.5. Embedding strategy

**Provider matrix:**

| Provider | Model | Dim | Use case | Cost (per 1M tok) |
|---|---|---|---|---|
| Voyage AI | voyage-3 | 1024 | Default (current) | $0.12 |
| Voyage AI | voyage-3-large | 2048 | Premium quality | $0.18 |
| OpenAI | text-embedding-3-large | 3072 (configurable 1024) | Fallback | $0.13 |
| Cohere | embed-multilingual-v3 | 1024 | Multilingual | $0.10 |
| Self-host | BGE-M3 | 1024 | Cost ceiling | $0 marginal + GPU |

**Cogniva choice: Voyage 3 → BGE-M3 self-host transition Stage 3**

**Embedding versioning:**
- Schema: `chunk.embedding_version` tracks which model generated
- Migration: re-embed all chunks when bumping (run as Inngest job, 2-4 weeks for 100M)
- Dual-write period: query both old + new, compare recall
- Cutover after recall difference < 2%

**Embedding cache:**
- Key: hash(text)
- Forever TTL (immutable text → same embedding)
- Saves 80% re-process cost when re-embedding

### 8.6. Fine-tuning pipeline (Stage 3, optional)

**When to fine-tune:**
- Have > 10K curated examples per task
- Off-shelf model can't reach quality bar
- Cost savings justify ($5K/mo+ on that task)

**Cogniva candidates:**
- Vietnamese exam grading (specific rubric)
- Vietnamese math step grading
- Vietnamese flashcard quality classifier
- Domain-specific RAG (medical, legal vertical if launched)

**Tools:**
- Anthropic fine-tune API (when available)
- OpenAI fine-tune (gpt-4o-mini)
- Together.ai for open models (Llama, Mistral)
- Modal for custom training on own GPU

**Pipeline:**
1. Collect data (production + human-curated)
2. Quality gate (manual review 5%)
3. Train (Together.ai or Modal)
4. Eval against golden set
5. A/B in production (1% → 10% → 100%)
6. Monitor drift, retrain quarterly

### 8.7. Online learning from feedback

**Sources of feedback:**
- Explicit: thumbs up/down on AI answer
- Implicit:
  - User re-asks (signal: previous answer poor)
  - User edits flashcard suggested (signal: imperfect)
  - User skips suggested concept (signal: not relevant)
  - Mastery improvement after AI explanation (signal: helpful)

**Pipeline:**
```
Feedback event → Kafka → consumer:
  ├→ Store in ClickHouse (analytics)
  ├→ Tag high-signal as training data (Postgres)
  └→ Weekly: aggregate signals → fine-tune training set
```

**Cold-start problem:**
- Use rule-based heuristics until > 1K feedback per task
- Then mix rules + ML
- Then ML primary, rules fallback

### 8.8. Prompt management & versioning

**Why critical:**
- Prompt changes → behavior changes → quality changes
- Without versioning, can't reproduce bugs, can't A/B
- Production prompts can be 5-50KB

**Tool: Promptfoo + custom registry**

**Storage:**
```sql
CREATE TABLE prompt (
  id text PRIMARY KEY,
  name text NOT NULL,          -- e.g. "rag-chat-system-v3"
  version integer NOT NULL,
  template text NOT NULL,       -- Liquid/Handlebars template
  variables jsonb,              -- expected variables
  metadata jsonb,               -- author, date, eval scores
  is_active boolean DEFAULT false,
  created_at timestamp,
  UNIQUE(name, version)
);
```

**Workflow:**
1. Engineer edit prompt in code repo
2. PR triggers eval against golden
3. If eval pass → register new version
4. Feature flag toggle: prompt_version = "v3"
5. Canary 1% → 10% → 100%
6. Old version archived (replay capability)

**Anti-pattern:** prompts as plain strings in code without version. Can't A/B, can't audit.

### 8.9. AI safety & content filters

**Layered defense:**

```
User input → 
  Layer 1: Input moderation (OpenAI moderation API, free)
    └─ Reject if hate/self-harm/sexual/violence > threshold
  Layer 2: Prompt injection detection (regex + LLM classify)
    └─ Strip suspicious patterns
  Layer 3: User policy check (rate limit, tier)
  Layer 4: System prompt (constitutional AI instructions)
  Layer 5: LLM call
  Layer 6: Output moderation (same as input)
  Layer 7: Citation enforcement (parse for [N] markers)
  Layer 8: PII scan (regex: email, phone, CCCD)
  Layer 9: Disclaimer footer if not present
  → User
```

**Safety prompts (system-level Cogniva):**
```
"You are an educational tutor for Vietnamese K-12 and university students.
Rules:
1. NEVER provide answers that bypass academic integrity (cheating).
2. If user asks about self-harm, respond with hotline 1800-1567 (UNICEF VN).
3. If user appears under 13 without parental consent, refuse.
4. Do not provide medical/legal/financial advice; suggest professional.
5. Always cite sources [N] when using retrieved context.
6. If unsure, say 'Mình không chắc, hãy kiểm tra với giáo viên'."
```

### 8.10. Mastery model ML pipeline

**Stage 2-3: Personalized FSRS**

**Pipeline:**
```
Daily Inngest job:
  For each active user (> 100 reviews):
    1. Load user's review history (ClickHouse)
    2. Fit FSRS params (gradient descent, 19 weights)
    3. Validate: hold-out Brier score
    4. If improvement > 5% vs prev: update user.fsrs_params
    5. Log: which subject improved/regressed
```

**Knowledge tracing (Stage 3+):**
- DKT (Deep Knowledge Tracing): RNN/Transformer predict mastery
- Feature: review sequence, concept graph context
- Output: P(correct | next question on concept C)
- Use case: adaptive question selection for practice mode

**Mastery decay model:**
- Forgetting curve per concept (varies by user)
- Calibrate weights based on actual review outcomes
- Re-introduce concepts at predicted decay threshold

**Concept similarity graph:**
- Embed each concept (description) via Voyage
- Cluster: similar concepts share mastery boost (transfer)
- Adaptive: if user struggles concept A, recommend prerequisites in cluster

---

## 9. Layer 6 — Observability & Resilience

### 9.1. Three pillars

#### 9.1.1. Metrics

**Stack:**
- **Stage 1**: Better Stack (managed Grafana + Loki, $25/mo basic)
- **Stage 2**: Grafana Cloud ($100-500/mo)
- **Stage 3**: Self-host Prometheus + Grafana on Hetzner

**What to measure (Cogniva-specific RED method):**
- **R**ate: requests/sec per route
- **E**rrors: error rate per route, by error class
- **D**uration: P50/P95/P99 latency per route

**Per-domain metrics:**
- API: per-endpoint latency, error rate, status code distribution
- AI: per-route TTFT, tokens/sec, cost/request, quality score
- DB: query latency, connection pool usage, replica lag, slow query count
- Cache: hit rate, eviction rate, key cardinality
- Realtime: WS connections active, message broadcast rate, room concurrent
- Mastery: reviews/day, FSRS predict accuracy, mastery progression

**Custom Cogniva metrics:**
```
cogniva.ai.cost.total{provider,model,user_tier}
cogniva.ai.tokens{type=input|output,provider,model}
cogniva.ai.eval.score{metric,route} (1% sampled)
cogniva.flashcard.review.outcome{state,subject,user_tier}
cogniva.room.participants.concurrent
cogniva.exam.live.concurrent{exam_id}
cogniva.fsrs.brier_score{subject,user_segment}
```

#### 9.1.2. Logs

**Stack:**
- **Stage 1**: Better Stack Logs (Loki-backed)
- **Stage 2-3**: Loki self-host + Grafana

**Structured logging (mandatory):**
```typescript
import { logger } from '@/lib/observability/logger';

logger.info('ai.request.completed', {
  trace_id: req.headers['x-trace-id'],
  user_id: session.user.id,
  route: 'ragChat',
  provider: 'anthropic',
  model: 'sonnet-4-6',
  latency_ms: 1234,
  tokens_in: 500,
  tokens_out: 300,
  cost_usd: 0.0049,
  faithfulness: 0.91,  // if sampled for eval
});
```

**Log levels:**
- ERROR: actionable problem, page on-call (Sentry alert)
- WARN: anomaly, review weekly
- INFO: business events (signup, payment, AI call)
- DEBUG: dev only, off in prod

**Retention:**
- Hot (queryable): 30 days
- Warm (S3): 90 days
- Cold (Glacier): 7 years for audit/compliance

#### 9.1.3. Traces

**Stack:**
- OpenTelemetry SDK in all services
- Stage 1: Sentry Performance (auto-instrumented Next.js)
- Stage 2: + Langfuse for LLM traces
- Stage 3: Tempo (Grafana) or Honeycomb

**What to trace:**
- All HTTP requests (auto)
- All DB queries (auto with Drizzle plugin)
- All LLM calls (Langfuse for prompt + output detail)
- All cache ops
- All external API calls (Stripe, FCM, etc.)

**Trace ID propagation:**
- W3C Trace Context header on all internal calls
- Inject into Inngest job context
- Surface trace ID in error logs + Sentry

**Sampling:**
- 100% errors (always trace)
- 1% successful (cost control)
- 100% in dev / staging
- Adaptive: high error rate → increase sampling

### 9.2. Real User Monitoring (RUM)

**Stack:**
- Vercel Speed Insights (Web Vitals: LCP, FID, CLS, INP, TTFB)
- PostHog session replay (debugging, 5% sample)
- Sentry frontend errors
- Synthetic tests (Checkly) from 10 cities, every 5min

**Cogniva-specific RUM:**
- Time to first message render in chat
- Time to flashcard interactive
- Time to video connected in room
- Time to AI first token (browser-side measurement)

**Mobile RUM (Stage 2+):**
- Sentry React Native SDK
- Performance metrics: app launch, screen transitions
- Crash-free users %

### 9.3. SLO/SLI definitions (Cogniva)

| Service | SLI | SLO Stage 2 | SLO Stage 3 | Error budget (Stage 3) |
|---|---|---|---|---|
| Web app | P95 < 300ms | 99.9% | 99.95% | 21min/month |
| API public | P99 < 1s | 99.9% | 99.95% | 21min/month |
| Auth | Login success rate | 99.9% | 99.99% | 4min/month |
| Chat delivery | Msg < 2s | 99.9% | 99.95% | 21min/month |
| Video RTT | < 200ms intra | 99% | 99.5% | 3.6hr/month |
| AI TTFT (Sonnet) | < 2s | 99% | 99.5% | 3.6hr/month |
| RAG quality | Faithfulness > 0.85 | 95% | 98% | per-day basis |
| Flashcard review | Save < 500ms | 99.9% | 99.99% | 4min/month |
| Database | Query P99 < 100ms | 99.9% | 99.95% | 21min/month |
| Payment | Success rate | 99.9% | 99.99% | 4min/month |

**Error budget policy:**
- < 50% burned: business as usual, ship features
- 50-100% burned: focus on reliability, fewer ship
- > 100% burned: freeze non-critical, all hands fix

### 9.4. Resilience patterns

#### 9.4.1. Circuit breakers

```typescript
import CircuitBreaker from 'opossum';

const llmBreaker = new CircuitBreaker(callAnthropic, {
  timeout: 30000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  rollingCountTimeout: 60000,
  rollingCountBuckets: 10,
});

llmBreaker.on('open', () => alert('LLM circuit open — fallback active'));
llmBreaker.fallback(() => callOpenAI()); // automatic fallback
```

**Apply to:**
- Every external API (LLM, Stripe, FCM, Whisper, Voyage, Cohere)
- Every microservice cross-call
- DB calls (with shorter timeout)

#### 9.4.2. Retries with backoff

```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: { maxRetries: 3, baseMs: 1000 }
): Promise<T> {
  for (let i = 0; i <= opts.maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === opts.maxRetries) throw err;
      if (!isRetryable(err)) throw err;
      const jitter = Math.random() * 0.3;
      const delay = opts.baseMs * Math.pow(2, i) * (1 + jitter);
      await sleep(delay);
    }
  }
}
```

**Retryable:**
- HTTP 429, 502, 503, 504
- Network ECONNRESET, ETIMEDOUT
- LLM provider 5xx

**Not retryable:**
- HTTP 4xx (except 429)
- Validation errors
- Authentication errors

#### 9.4.3. Timeouts hierarchy

| Operation | Timeout |
|---|---|
| Hot path API | 5s |
| Standard API | 30s |
| AI streaming | 120s |
| File upload | 5min |
| DB query (indexed) | 1s |
| DB query (analytics) | 30s |
| Inngest function | 15min |
| LiveKit signaling | 30s |
| WebSocket ping/pong | 60s |

**Rule:** Outer timeout > sum of inner timeouts. Otherwise cascading failures.

#### 9.4.4. Bulkhead pattern

**Connection pool isolation:**
```
Postgres pool sizes per workload:
- API requests:     50 connections
- Inngest jobs:     30 connections  
- Analytics queries: 10 connections (separate read replica)
- Health checks:     5 connections
Total: ~95 (Neon Pro tier 1000)
```

**Concurrency limits per user:**
- Free: 5 concurrent AI requests
- Pro: 20 concurrent
- Team: 100 concurrent

**Org-level quota:**
- Prevent 1 noisy org killing shared resources
- Implementation: token bucket per org in Redis

#### 9.4.5. Graceful degradation

| Component down | Fallback |
|---|---|
| LLM provider primary | Switch to fallback chain |
| All LLM providers | Show cached answer if exists, else "AI temporarily unavailable" |
| Search Meilisearch | Fallback to Postgres BM25 |
| Cache (Redis) | Hit DB directly, log slow path |
| Real-time (Soketi) | Polling fallback (10s interval) |
| Video (LiveKit) | Audio-only mode |
| Whiteboard collab | Read-only snapshot |
| Recording (egress) | Disable record button, show "service degraded" |
| Database primary | Read-only mode (replicas) for 5min, then 503 |

### 9.5. Chaos engineering (Stage 3)

**Tools: Chaos Mesh (Kubernetes) or Litmus**

**Schedule:**
- Weekly: kill random pod in staging
- Bi-weekly: inject 200ms network latency
- Monthly: simulate region failure (block traffic)
- Quarterly: DB failover drill (full prod-like)

**Game days:**
- Quarterly war-room exercise
- Scenario: "AWS us-east-1 down" → team responds
- Document gaps → backlog fixes

### 9.6. Incident response

**Incident severity:**
- **SEV1**: Production down, all users affected. Page on-call immediately. RTT < 5min.
- **SEV2**: Major feature broken, > 10% users. Page on-call. RTT < 15min.
- **SEV3**: Minor feature, < 10% users. Slack alert. RTT < 1h.
- **SEV4**: Cosmetic, no user impact. Backlog ticket.

**Roles during incident:**
- **Incident Commander (IC)**: coordinator, makes decisions
- **Technical Lead**: hands-on debugging
- **Communications**: status page, customer support
- **Scribe**: timeline log for post-mortem

**Tools:**
- PagerDuty for on-call rotation
- Slack `#incidents` channel
- Status page (Better Stack / Atlassian Statuspage)
- Post-mortem template (blameless)

**Post-mortem (within 48h after SEV1/2):**
- Timeline of events
- Root cause
- What went well / poorly
- Action items (with owners + due dates)
- Share company-wide

---

## 10. Layer 7 — Security & Compliance

### 10.1. Security baseline

**Network:**
- ✅ WAF rules Cloudflare (OWASP Top 10)
- ✅ DDoS protection automatic (Cloudflare)
- ✅ Rate limiting per IP / per user / per endpoint
- ✅ Bot detection (Cloudflare Turnstile for forms)
- ✅ HSTS preload list
- ✅ Subresource Integrity (SRI) cho external scripts

**Application:**
- ✅ CSRF tokens (SameSite=Lax cookies + custom header)
- ✅ Content Security Policy strict (no unsafe-inline, nonce-based)
- ✅ Input validation everywhere (Zod schemas at boundary)
- ✅ SQL injection prevention (parameterized queries, ORM)
- ✅ XSS prevention (React auto-escape + DOMPurify for markdown)
- ✅ CORS strict whitelist
- ✅ Authorization checks at every endpoint (not just middleware)
- ✅ Avoid `dangerouslySetInnerHTML` except for sanitized markdown

**Code:**
- ✅ Dependency scanning (Snyk, Dependabot, GitHub Advisory)
- ✅ SAST (Semgrep, CodeQL)
- ✅ Container scan (Trivy)
- ✅ Pre-commit secret scanner (Gitleaks)
- ✅ Code review mandatory (no direct push to main)

### 10.2. AuthN/AuthZ

#### 10.2.1. Authentication evolution

| Stage | Method | Why |
|---|---|---|
| M1-M3 | Better Auth + email/password + Google OAuth | Current, OK |
| M3-M6 | + Passkeys (WebAuthn) | UX upgrade |
| M6-M12 | + Apple/Facebook OAuth | Mobile growth |
| M9-M12 | + 2FA TOTP | Security upgrade |
| M12-M18 | + SSO/SAML (WorkOS) | Enterprise sales |
| M18+ | + OIDC for SCIM provisioning | Enterprise managed |

**Session management:**
- Stage 1: Better Auth DB sessions (current)
- Stage 2: JWT short-lived (1h) + refresh token rotating (30d)
- Refresh token stored in HttpOnly Secure cookie
- Revocation list in Redis (TTL = refresh TTL)
- Session invalidation on:
  - Password change
  - 2FA enable/disable
  - Suspicious activity (geo jump, new device)
  - User explicit logout-everywhere

#### 10.2.2. Authorization (RBAC + ABAC hybrid)

**Roles (Cogniva):**
- `user` (default)
- `student` (assigned to class)
- `teacher` (creates classes, exams)
- `school_admin` (manages school org)
- `super_admin` (Cogniva staff)
- `support` (read-only access for help)

**Attribute-based (per resource):**
- `room.owner_id == user.id` → full control
- `room.members ∋ user.id` → read/write
- `school.teachers ∋ user.id` → grade exams
- `student.parent_id == user.id` → view dashboard

**Implementation:**
- Stage 1: hand-rolled per route (current Cogniva pattern)
- Stage 2-3: policy-based with [Cerbos](https://cerbos.dev) or [OpenFGA](https://openfga.dev)

**Policy example (Cerbos):**
```yaml
resourcePolicy:
  resource: room
  rules:
    - actions: [view, chat]
      effect: ALLOW
      roles: [user]
      condition:
        match:
          expr: request.principal.id in request.resource.attr.member_ids
    - actions: [delete, kick_member]
      effect: ALLOW
      condition:
        match:
          expr: request.principal.id == request.resource.attr.owner_id
```

### 10.3. Secrets management

**Stage 1: Vercel + Doppler**
- Vercel env vars (gitignore safe)
- Doppler for shared secrets ($0 up to 10 secrets)

**Stage 2: Infisical or HashiCorp Vault**
- Self-host Infisical Cloud free OR Vault on Hetzner
- Sync to Vercel/Fly via integration
- Secret rotation quarterly automated

**Best practices:**
- ❌ Never commit secrets (pre-commit hook + Gitleaks)
- ❌ Never log secrets (filter in logger)
- ❌ Never include in error messages
- ✅ Rotate quarterly: API keys, DB passwords, JWT secrets
- ✅ KMS encryption for secrets at rest
- ✅ Different secrets per env (dev/staging/prod)
- ✅ Least-privilege access (per-service secrets)

**Emergency rotation playbook:**
1. Generate new secret
2. Deploy with both old + new accepted
3. Force re-issue all clients
4. Wait 24h for stragglers
5. Remove old secret
6. Audit access logs for misuse

### 10.4. Data protection

#### 10.4.1. Encryption

- **At rest:** AES-256 (Postgres TDE, R2 default, Redis encrypt)
- **In transit:** TLS 1.3 mandatory, no 1.2 unless legacy mobile
- **Field-level:** for sensitive PII (CCCD, payment info)
  - Use KMS-derived key per record
  - Encrypted column + key reference (envelope encryption)
- **Backups:** encrypted with separate KMS key
- **Audit logs:** encrypted, immutable (write-once)

#### 10.4.2. PII detection & DLP

**Data classification:**
- **Public**: marketing content, public docs
- **Internal**: business metrics, aggregated data
- **Confidential**: user content, chat, documents
- **Restricted**: PII (CCCD, email, phone, address, payment)
- **Highly Restricted**: passwords, JWT secrets, encryption keys

**PII detection pipeline (Stage 2):**
```
Every text content stored:
  ├─ Regex: email, phone (VN format), CCCD (12 digits)
  ├─ NER (LLM-as-detector or self-host model)
  ├─ If PII detected:
  │   ├─ Tag in metadata
  │   ├─ Apply field-level encryption
  │   └─ Audit log access
  └─ Mask in logs / analytics
```

**Tools:**
- AWS Macie (if AWS)
- Presidio (Microsoft, open source)
- DIY: regex + Claude Haiku batch classify

#### 10.4.3. Right to be forgotten

(See §5.9 for implementation detail)

#### 10.4.4. Data export (GDPR Article 20)

- API: `POST /api/account/export`
- Inngest job collects all user data:
  - Profile + settings
  - Documents (with files from R2)
  - Conversations + messages
  - Flashcards + review history
  - Mastery state
  - Audit log relevant to user
- Output: ZIP with JSON files + media
- Delivered via signed URL (TTL 7 days)
- SLA: < 30 days (GDPR), target < 24h

### 10.5. Compliance roadmap (Cogniva-specific)

**Phase 1 (M1-M6, foundational):**
- ✅ GDPR baseline (EU users)
- ✅ Privacy policy + ToS lawyer-reviewed
- ✅ Cookie consent (essential / functional / marketing)
- ✅ Data Processing Agreement template
- ✅ Sub-processor list public
- ✅ DPA with vendors (Anthropic, Voyage, Cohere, Vercel, etc.)

**Phase 2 (M6-M12, certifications):**
- ⏳ SOC2 Type 1 (with Drata or Vanta, ~$15K + audit cost)
- ⏳ FERPA compliance (US K-12 enterprise sales)
- ⏳ COPPA compliance (under-13 users)
- ⏳ CCPA (California users)
- ⏳ ISO 27001 prep (paper docs ready)

**Phase 3 (M12-M18+, deep):**
- ⏳ SOC2 Type 2 (12 month observation period)
- ⏳ HIPAA-ready (healthcare partner ed-tech)
- ⏳ ISO 27001 certified
- ⏳ APEC CBPR (cross-border data)
- ⏳ VN MOET registration (if selling to VN schools enterprise)

**Compliance technology stack:**
- **Drata / Vanta**: continuous compliance monitoring (~$15K/yr)
- **OneTrust / TrustArc**: privacy management (DPIA, RoPA)
- **DataDome / Cloudflare Bot Mgmt**: fraud + abuse
- **CloudQuery**: cloud config monitoring (drift detection)

### 10.6. Security operations

**Bug bounty program (Stage 2):**
- HackerOne or Intigriti
- Scope: production app, mobile app, public API
- Rewards: $100-$10K based on severity
- ROI: external testing cheaper than full-time AppSec

**Penetration testing:**
- Quarterly external pentest (Cure53, Trail of Bits, NCC Group)
- Cost: $20-40K per engagement
- Required for SOC2 + enterprise sales

**Vulnerability management:**
- Dependabot auto-PR for low-risk updates
- Manual review for major version bumps
- SLA: critical CVE patched within 48h, high within 7d

**Incident response (security-specific):**
- Playbook: account takeover, data breach, DDoS, ransomware
- Communication plan: legal team, customer notification (72h GDPR)
- Forensics: log retention 1 year minimum
- Cyber insurance: $1M+ coverage

### 10.7. Tenant isolation (multi-tenant)

**Cogniva tenant model:**
- Individual users (B2C)
- Schools / Organizations (B2B)
- Class / Section (within school)
- Hierarchy: School → Class → Student

**Isolation level:**

| Tier | Isolation | Pattern |
|---|---|---|
| Free / Pro | Row-level (RLS) | `WHERE user_id = current_user` |
| Team | Row-level + namespace | `WHERE org_id = current_org` |
| Enterprise School | Logical DB (schema per school) | `SET search_path = school_{id}` |
| Enterprise District | Dedicated DB | Separate Neon project |

**Postgres Row Level Security (RLS):**
```sql
ALTER TABLE flashcard ENABLE ROW LEVEL SECURITY;

CREATE POLICY flashcard_user_isolation ON flashcard
FOR ALL
USING (user_id = current_setting('app.current_user_id')::text);

-- In app: SET app.current_user_id = '{session.userId}' per connection
```

**RLS gotchas:**
- Performance: RLS adds WHERE clause to every query → ensure indexes
- Connection pooling: per-tx SET (use pgBouncer transaction mode)
- Test thoroughly: forgot one policy = data leak

### 10.8. Audit logging

**What to audit (immutable, 7yr retention):**
- Authentication events (login, logout, failed)
- Authorization events (permission grant/revoke)
- PII access (who saw what when)
- Admin actions (user role change, account delete)
- Compliance events (data export, deletion)
- Security events (rate limit hit, suspicious geo)
- Financial events (payment, refund, billing change)

**Schema:**
```sql
CREATE TABLE audit_log (
  id text PRIMARY KEY,
  actor_id text NOT NULL,        -- who
  actor_type text NOT NULL,       -- 'user' | 'system' | 'admin'
  action text NOT NULL,           -- 'login' | 'document.read' | 'role.assign'
  resource_type text,             -- 'document' | 'user' | 'flashcard'
  resource_id text,
  result text NOT NULL,           -- 'success' | 'denied' | 'error'
  ip_address inet,
  user_agent text,
  metadata jsonb,
  trace_id text,
  timestamp timestamptz NOT NULL DEFAULT now()
);

-- Append-only enforced via DB trigger blocking UPDATE/DELETE
```

**Archive pipeline:**
- Postgres `audit_log` partition by month
- Monthly: move > 30 day old partitions to ClickHouse
- Yearly: archive ClickHouse → R2 immutable Parquet
- 7 year retention for compliance

---

## 11. Layer 8 — Mobile & Cross-Platform

> **Lý do là layer độc lập:** Plan v1 bỏ qua mobile. Sai. Ed-tech 60-70% traffic mobile sau 6 tháng launch. Nếu không ship mobile sớm → mất nửa market.

### 11.1. Mobile strategy decision

**Options matrix:**

| Approach | Pros | Cons | Cogniva fit |
|---|---|---|---|
| **PWA only** | Cheap, share code | iOS notification limited, no AppStore presence, install friction | ❌ Insufficient |
| **React Native + Expo** | Share TS code, fast iterate, OTA updates | Some native limits | ✅ **PRIMARY CHOICE** |
| **Native iOS + Android** | Best UX, full platform features | 2x team, slow iterate, hire iOS+Android eng | ❌ Too expensive for Stage 2 |
| **Flutter** | Cross-platform single codebase | Dart language, smaller TS ecosystem | ❌ Loses Cogniva TS reuse |

**Decision: React Native + Expo + EAS, ship M6**

**Why:**
- 70% code reuse with web (zustand, business logic, API client)
- Expo handles signing, OTA updates, push notifications
- EAS Build for cloud CI
- Native modules when needed (LiveKit RN SDK exists)

### 11.2. Architecture

```
apps/
  web/             Next.js web (current)
  mobile/          React Native + Expo (new, M6)
  shared/          Shared utils, types, API client
    api/           OpenAPI generated client
    schemas/       Zod schemas (shared validation)
    types/         TS types
    utils/         Pure utils (date, format, validation)
    
packages/
  db/              (existing) Drizzle schema
  ui-mobile/       React Native components (port shadcn)
  ui-web/          (existing) shadcn
  ai/              (new Stage 2) shared LLM client
```

**Mobile-specific stack:**
- **Routing:** Expo Router (file-based, similar to Next.js)
- **State:** Zustand (same as web)
- **Forms:** React Hook Form + Zod (same as web)
- **API client:** OpenAPI generated, fetch with auto retry
- **Realtime:** Pusher RN SDK + LiveKit RN SDK
- **Storage:** AsyncStorage + Expo SecureStore for tokens
- **Push:** Expo Notifications + APNs/FCM credentials
- **Analytics:** PostHog RN
- **Errors:** Sentry RN

### 11.3. Offline-first sync (Cogniva critical feature)

**Why critical:** ed-tech users learn on subway, school WiFi flaky, internet outages.

**Sync architecture:**
```
Mobile:
  ├─ Local DB: WatermelonDB (SQLite reactive)
  ├─ Sync engine: pull/push protocol
  ├─ Conflict resolution: last-write-wins with timestamps
  └─ Background sync: every 5min when online

Server:
  ├─ /api/sync/pull?since={lastSyncAt}
  │   → Returns: changes since timestamp
  └─ /api/sync/push
      → Accepts: client changes
      → Resolves: conflicts (server wins for critical, client wins for prefs)
```

**Offline-capable features:**
- ✅ Flashcard review (FSRS calc local, sync states later)
- ✅ Document read (cache PDF locally up to 100MB)
- ✅ Mastery dashboard (last cached state)
- ✅ Notes view (read-only when offline)

**Online-only features:**
- ❌ Room (real-time)
- ❌ AI chat
- ❌ Live exam
- ❌ Video recording

**Conflict resolution per entity:**
- `flashcard.due` (FSRS state): server authoritative (mathematical truth)
- `review` (history): append-only, no conflict
- `note.content`: CRDT (Yjs offline sync)
- `mastery.score`: server-computed
- `user.settings`: last-write-wins

### 11.4. Push notifications mobile

**Cogniva push types:**
1. **Daily review reminder** (9am user-tz local time)
2. **Streak risk** ("Bạn còn 4h để giữ streak 30 ngày")
3. **Room invitation** (real-time)
4. **Chat mention** (room with @username)
5. **Exam start** (5min before scheduled)
6. **Friend joined** (social discovery)

**Implementation:**
- Backend → Knock → Expo Push Token → FCM/APNs
- Rich notifications (image, action buttons)
- Deep links to relevant screen
- Quiet hours (per user-tz)
- Frequency cap (max 5/day)

### 11.5. App Store Optimization (ASO)

**iOS App Store + Google Play:**
- App name keyword: "Cogniva - AI Học Tập"
- Subtitle: "Học mọi môn, ghi nhớ lâu"
- Description: SEO-optimized 4000 chars
- Screenshots: 5-8 with text overlay (localized VN/EN)
- Preview video: 30s feature highlight
- Localization: VN + EN initially, sau M12 mở rộng

**Review management:**
- Reply within 24h all reviews
- Trigger review prompt: after 5th flashcard streak day
- Don't trigger on errors
- A/B test review prompt timing

### 11.6. Mobile-specific features

**iOS:**
- Widgets: today's flashcards, streak counter
- Shortcuts (Siri): "Học flashcard" → opens app
- Apple Pencil for whiteboard/notes
- iPad split-screen multitask
- Sign in with Apple (App Store requirement if Google OAuth present)

**Android:**
- Material You theming
- Widgets (similar to iOS)
- Google Assistant integration
- Tablet split-screen
- Foldable optimization (Samsung Fold)

**Cross-platform:**
- Dark mode (system-driven)
- Accessibility (TalkBack, VoiceOver)
- Haptic feedback for review interactions
- Camera scan (document upload via camera)
- File picker (Drive, Dropbox integration)

### 11.7. Mobile release cadence

- **Update OTA (Expo Updates):** weekly via EAS
  - Bug fixes, copy changes, minor features
- **Full app store release:** monthly
  - Native module updates, major features
- **Beta testing:** TestFlight + Google Play Beta
  - 500 internal testers minimum
  - 1-week beta before prod release

---

## 12. Layer 9 — Growth & Product Analytics

> **Why a layer:** Without analytics, you fly blind. Cogniva eval needs are 10x normal SaaS (per-subject quality, mastery tracking, FSRS accuracy).

### 12.1. Event tracking specification

**Event taxonomy (strict naming convention):**
```
[object]_[verb]_[state?]

Examples:
- account_signed_up
- account_logged_in
- account_logged_out
- document_uploaded
- document_processed
- document_deleted
- flashcard_reviewed
- flashcard_review_rated  
- room_created
- room_joined
- room_left
- exam_started
- exam_submitted
- exam_graded
- ai_query_sent
- ai_response_received
- payment_initiated
- payment_succeeded
- payment_failed
- subscription_upgraded
- subscription_downgraded
- subscription_canceled
```

**Property convention:**
```typescript
type EventProperties = {
  // Always include
  user_id: string;
  session_id: string;
  app_version: string;
  platform: 'web' | 'ios' | 'android';
  
  // Common
  org_id?: string;       // multi-tenant
  region?: string;       // data residency
  experiment_variants?: Record<string, string>;  // A/B
  feature_flags?: string[];  // which flags ON
  
  // Event-specific
  [key: string]: unknown;
};
```

**Tracking governance:**
- ✅ Event spec doc in repo (`/docs/events-spec.md`)
- ✅ TS types for every event (compile-time check)
- ✅ Review event addition in PR
- ✅ Deprecation process (mark `_deprecated_at`, drop after 30d)
- ❌ No event without spec
- ❌ No PII in event properties

### 12.2. Customer Data Platform (CDP)

**Stage 1: PostHog free (current)**
- Up to 1M events/mo free
- Funnel, retention, paths, A/B basic

**Stage 2: PostHog Cloud or self-host on ClickHouse**
- Self-host PostHog (OSS) trên Hetzner — $80/mo for 100M events
- Or PostHog Cloud: $0.00031/event

**Stage 3: Segment + ClickHouse + dbt**
- Segment as CDP (warehouse-first model)
- Source: app SDK, server-side tracking
- Destinations: ClickHouse (analysis), Stripe (revenue ops), Customer.io (lifecycle), Slack (alerts)
- dbt for modeling (user_metrics, cohort, etc.)

**Reverse ETL (Stage 3):**
- Hightouch or Census
- ClickHouse → CRM (HubSpot/Salesforce)
- Aggregate user state → marketing segments
- Trigger lifecycle email based on behavior

### 12.3. Experimentation platform

**Stage 2: PostHog Experiments (free)**
- Feature flag A/B
- Statistical significance auto-compute
- Per-experiment dashboards

**Stage 3: Statsig or Eppo**
- Multi-variate
- Heterogeneous treatment effects
- Sequential testing
- Power analysis built-in

**Cogniva experiment ideas:**
- Onboarding flow variants (3-step vs 5-step)
- Prompt versioning A/B (which prompt has higher engagement)
- Pricing copy (savings emphasized vs feature emphasized)
- Email subject lines
- Notification timing (7am vs 9am vs evening)
- Recommendation algorithms (concept-based vs collab filter)
- FSRS personalized vs global params

**Experiment hygiene:**
- Pre-register hypothesis + success metric
- Minimum sample size calculated
- No peeking (don't stop early)
- 2-week minimum duration
- Document learning (win/lose/neutral)

### 12.4. Funnel & retention analytics

**Cogniva north star metrics:**
- **Activation**: % new signups who do 10 flashcards in first 7 days
- **Engagement**: D7 retention, D30 retention
- **Habit**: % users with 7-day streak
- **Monetization**: Free → Pro conversion rate, MRR
- **Quality**: avg mastery score growth/week per user
- **Virality**: K-factor (invites sent / signups)

**Funnel tracking:**
```
Signup → Email verify → Onboarding complete → First doc upload 
       → First chat → First flashcard review → 7-day streak
```

**Cohort analysis:**
- Weekly cohort: sign-up week
- Track retention at D1, D7, D30, D90
- Compare cohorts pre/post feature launch
- Plot in dashboard

**Segment analysis (Stage 3):**
- Power users (top 10% by reviews/week)
- At-risk users (declining engagement 7 days)
- Whales (top 1% revenue)
- Churners (no activity 14 days)

### 12.5. SEO infrastructure

**Why ed-tech SEO matters:**
- 40% of ed-tech traffic from organic search
- "Học [môn]" queries high volume
- SEO is moat (compound returns)

**Stack:**
- Next.js SSG + ISR (current)
- Sitemap auto-generated (`/sitemap.xml`)
- robots.txt
- Structured data (Schema.org Course, Quiz, EducationalOrganization)
- OpenGraph + Twitter Cards
- Canonical URLs
- hreflang for multi-lang

**Content strategy:**
- Public study guides (per-concept landing pages)
- Practice exams (free, indexed)
- Blog (study tips, exam prep)
- Glossary (concept dictionary)

**Performance:**
- Core Web Vitals: pass on 90%+ pages
- LCP < 2.5s (Lighthouse green)
- Image: WebP + lazy load + responsive sizes
- Font: preload critical, subset VN

**Internal linking:**
- Knowledge graph → SEO sitemap
- Each concept page links related concepts
- Breadcrumb structured data
- Related articles widget

**Tools:**
- Google Search Console (free, must)
- Ahrefs or Semrush (Stage 2, $99/mo)
- Lighthouse CI (every PR)
- Schema validator

### 12.6. Email & lifecycle marketing

**Stack:**
- **Stage 1**: Resend (transactional) — $0 up to 3K/mo, $20/mo for 50K
- **Stage 2**: Postmark (transactional) + Customer.io (lifecycle)
- **Stage 3**: SendGrid (transactional, deliverability mature) + Braze (lifecycle, full CRM)

**Email types:**
1. **Transactional** (must deliver):
   - Welcome
   - Email verify
   - Password reset
   - Payment receipt
   - Subscription change
   
2. **Lifecycle** (engagement):
   - Onboarding drip (7 days, 5 emails)
   - Weekly recap (mastery progress, week summary)
   - Re-engagement (14 days inactive)
   - Milestone (100 reviews, 30-day streak)
   - Feature announcements
   - Win-back (canceled subscribers, 30 days)
   
3. **Marketing** (opt-in only, GDPR):
   - Newsletter (monthly)
   - Webinar invites
   - Product updates
   - Surveys

**Deliverability:**
- SPF + DKIM + DMARC mandatory
- Dedicated IP at > 100K sends/mo (warm up 30 days)
- Suppression list automatic (bounces, complaints)
- One-click unsubscribe (CAN-SPAM, RFC 8058)
- Sender reputation monitoring (Google Postmaster Tools)

### 12.7. Referral & viral loops

**Cogniva-specific referral mechanics:**
- "Mời bạn cùng học" → both get 1 month Pro free
- Class invite link (1 teacher invites N students → org credit)
- Shared deck link (deck creator gets credit when reused)

**K-factor target:** 0.5 (each user brings 0.5 new users on average)

**Anti-fraud:**
- Email verify required before credit
- Device fingerprint check (same device = no credit)
- Rate limit invite sends
- Manual review for high-volume inviters

### 12.8. Pricing & monetization

**Tier structure (Stage 1-2):**

| Tier | Price/mo | Features |
|---|---|---|
| Free | $0 | 3 docs, 100 flashcards, 50 AI queries/day, no rooms |
| Pro | $9-12 | Unlimited docs, unlimited flashcards, 500 AI queries/day, 5 rooms/mo |
| Team | $25/seat | + collaboration, shared decks, analytics, priority support |
| School | Custom | + SSO, FERPA compliance, dedicated support, custom integrations |

**Pricing experiments:**
- Annual discount (20% off)
- Student discount (50% off with .edu email)
- Family plan (4 seats at 50% Pro price)
- Lifetime deal (limited time, growth hack)

**Localized pricing (Stage 2):**
- VN: ₫149K/mo Pro (USD $6 equivalent)
- IN: ₹599/mo Pro
- BR: R$29/mo Pro
- Use Stripe Tax + locale-aware pricing

### 12.9. Attribution & MMM

**Attribution challenges (Stage 2+):**
- iOS ATT (App Tracking Transparency) breaks IDFA
- Browser privacy (Safari ITP, Firefox blocks)
- Cookie-less future

**Solution stack:**
- Server-side tracking (Facebook CAPI, Google Enhanced Conversions)
- First-party data foundation (own CDP)
- Probabilistic matching (statistical, not deterministic)
- Marketing Mix Modeling (MMM) for incrementality

**Tools:**
- Stage 2: Stape (server-side GTM)
- Stage 3: Meta CAPI Gateway, Triple Whale (MMM)

---

## 13. Layer 10 — Customer Operations

> **Why a layer:** Plan v1 missed this entirely. At 50K MAU, support tickets explode. Without infra, founders drown.

### 13.1. Support tooling

**Stage 1 (M1-M3): Email + Notion docs**
- support@cogniva.app (forwarded to founder)
- Basic FAQ in public Notion
- Response SLA: best effort

**Stage 2 (M4-M9): Plain or Help Scout**
- Plain: dev-friendly, modern UI ($59/mo)
- Help Scout: email-based, no chat UI ($25/agent)
- Knowledge base public site
- SLA: < 24h response, < 72h resolve

**Stage 3 (M9+): Intercom or Front**
- Intercom: full suite (chat, email, KB, automation) ($200+/mo)
- Front: shared inbox + routing
- Add live chat for Pro/Team tier
- AI suggested replies (use own LLM)

**Support metrics:**
- First Response Time (FRT): < 1h business hour
- Resolution time (median): < 24h
- CSAT score: > 4.5/5
- Tickets per active user: < 0.05/month

### 13.2. In-app help

**Layered help system:**
1. **Tooltips**: contextual hint on hover
2. **Empty states**: helpful when feature unused
3. **Help center widget**: search KB inline
4. **Chat widget** (Pro/Team): live agent or AI bot
5. **Video tutorials**: embedded in app
6. **Interactive onboarding**: product tour (Userflow, Appcues)

**Self-serve KB:**
- 50-100 articles covering top tasks
- Search-optimized (Algolia DocSearch free)
- Vietnamese + English
- Updated weekly based on ticket trends

**AI support agent (Stage 3):**
- Train on KB + ticket history
- Answer common questions instantly
- Escalate to human if confidence < 80%
- Track deflection rate (% tickets resolved without human)

### 13.3. Status page

**Public status page (mandatory from M1):**
- Atlassian Statuspage or Better Stack ($30/mo)
- Subdomain: status.cogniva.app
- Components: Web, API, AI, Realtime, Database, Storage
- Auto-update from monitoring (PagerDuty integration)
- Subscribe via email/SMS
- Historical uptime visible

**Communication during incident:**
- SEV1: update every 30min on status page
- Slack + Twitter for major outages
- Post-incident report linked

### 13.4. Trust & safety operations

**T&S team (Stage 3, M12+):**
- 2-3 dedicated FTE
- Cover content moderation, abuse reports, T&S investigations

**Tools:**
- Moderation queue (custom built or [Sift](https://sift.com))
- Reporting flow (in-app "Report this")
- Tracking system (which content / user / action)
- Appeal mechanism

**Policies:**
- Community guidelines (public)
- Acceptable use policy
- Content moderation guidelines (internal)
- Appeal process documented

**Abuse handling:**
- Spam: auto-detect + soft delete
- Harassment: 3-strike system
- Self-harm: immediate intervention + hotline
- Illegal content: report to authorities (CSAM, terrorism)
- DMCA: takedown process

### 13.5. Account management (Enterprise, Stage 3)

**Customer Success team:**
- 1 CSM per $1M ARR account (Stage 3+)
- Onboarding playbook (8-week ramp)
- Quarterly Business Review (QBR)
- Usage analytics dashboard for customer
- Renewal forecast tracking

**Enterprise-specific features:**
- Dedicated Slack channel
- Custom SLA (99.95% with credits)
- Priority bug fixes
- Custom integrations (LMS, SIS)
- On-site training option

### 13.6. Billing & subscription infrastructure

**Stack:**
- **Payment processing:** Stripe
- **Tax:** Stripe Tax (auto-calculate VAT, GST, sales tax)
- **Subscription management:** Stripe Billing
- **Invoicing:** Stripe Invoicing
- **Dunning:** Stripe Smart Retries + Customer.io for re-engagement

**Subscription state machine:**
```
trial → active → past_due → canceled
   ↓        ↓         ↓          ↓
expired  paused  recovered  reactivated
```

**Stripe webhooks handled:**
- customer.subscription.created/updated/deleted
- invoice.paid/failed
- charge.succeeded/refunded
- payment_intent.* (3D Secure flow)

**Invoice & tax:**
- VN: VAT 10% B2B (need invoice with company tax ID)
- EU: VAT MOSS (Stripe handles)
- US: state-specific sales tax (Stripe Tax)
- Annual prepay invoice (Net 30 for enterprise)

**Subscription analytics (essential):**
- MRR growth rate
- Net Revenue Retention (NRR): > 100% goal
- Gross churn rate
- LTV / CAC ratio: > 3 healthy
- Cohort revenue retention

**Subscription edge cases:**
- Pro/rate during plan change (upgrade vs downgrade)
- Trial conversion email sequence
- Failed payment retry (3 attempts over 14 days)
- Account suspension after 30 days unpaid (data preserved 60 days)
- Currency conversion locked at signup

---

## 14. Layer 11 — Content & Education-Specific

> **Why a layer:** Cogniva is ed-tech, not generic SaaS. Education-specific challenges deserve dedicated infrastructure.

### 14.1. Educational content QA at scale

**Problem:** User uploads PDF of low-quality content → AI trains on it → poor responses.

**Pipeline (Stage 2):**
```
Upload → Quality gate:
  ├─ OCR confidence (rejected if < 80%)
  ├─ Language detection (warn if not VN/EN)
  ├─ Subject classification (taxonomy mapping)
  ├─ Difficulty estimation (grade level)
  ├─ Duplicate detection (perceptual hash + content)
  ├─ Plagiarism check (similarity vs known sources)
  ├─ Copyright flag (textbook scan detection)
  └─ Approved → ingest pipeline
```

**Quality scoring per chunk:**
- Coherence (does it stand alone semantically?)
- Density (info-rich vs filler?)
- Citation quality (has references?)
- Recency (publication date if extractable)
- Use in mastery model with weight

### 14.2. Curriculum mapping

**Vietnamese MOET curriculum (SGK 2018):**
- Map concepts to grade level (Lớp 1-12)
- Map to subject (Toán, Lý, Hoá, ...)
- Map to chapter / lesson
- Reference textbook page

**Schema:**
```sql
CREATE TABLE curriculum_node (
  id text PRIMARY KEY,
  grade integer,            -- 1-12 or null (university)
  subject text,             -- 'math' | 'physics' | ...
  chapter text,
  lesson text,
  parent_id text REFERENCES curriculum_node(id),
  source text,              -- 'MOET_SGK_2018' | 'university_custom'
  metadata jsonb            -- ISBN, page refs, etc.
);

CREATE TABLE concept_curriculum (
  concept_id text REFERENCES concept(id),
  curriculum_node_id text REFERENCES curriculum_node(id),
  confidence real,          -- AI-estimated match quality
  PRIMARY KEY (concept_id, curriculum_node_id)
);
```

**Use cases:**
- Recommend content matching student's current grade
- Filter "advanced" concepts for younger users
- Generate exam aligned to specific chapter
- Teacher dashboard: track class progress vs curriculum

**International curriculum (Stage 3+):**
- US Common Core
- UK National Curriculum
- IB Programme
- AP courses

### 14.3. Multi-language support

**Stage 1-2: VN + EN**
- UI translated (Next.js i18n routing)
- Content language detection per upload
- Cross-language search (embed unified)

**Stage 3+: SEA + global**
- Indonesian, Thai, Filipino (high ed-tech market)
- Hindi, Bengali (India market)
- Spanish, Portuguese (LatAm)

**i18n stack:**
- Next-intl (Next.js i18n routing)
- Crowdin or Lokalise for translation management
- Auto-translate fallback (DeepL or LLM)
- RTL support (Arabic, Hebrew)

**Translation policy:**
- UI strings: human-translated for top 5 langs, machine for rest
- User-facing emails: human-translated mandatory
- AI responses: respond in user's preferred language
- Legal docs: human-translated certified mandatory

### 14.4. Accessibility (WCAG 2.1 AA)

**Required from M3 (compliance + user inclusion):**

**Visual:**
- ✅ Color contrast ratio ≥ 4.5:1 (AA standard)
- ✅ Don't rely on color alone (use icons + text)
- ✅ Resizable text up to 200% without breaking
- ✅ Dark mode support
- ✅ Focus indicators visible

**Keyboard:**
- ✅ All interactive reachable via Tab
- ✅ Skip-to-content link
- ✅ No keyboard traps
- ✅ Shortcuts documented (Cmd+K, etc.)

**Screen reader:**
- ✅ Semantic HTML (`<main>`, `<nav>`, `<button>`)
- ✅ ARIA labels for icons-only
- ✅ ARIA live regions for dynamic content
- ✅ Alt text for all images
- ✅ Captions for video content

**Cognitive:**
- ✅ Plain language (Flesch reading score)
- ✅ Consistent navigation
- ✅ Error messages helpful (not just "Error")
- ✅ Time-limit warnings (exam: pause option)
- ✅ Reduced motion option

**Testing:**
- Axe DevTools (auto)
- Manual screen reader test (NVDA + VoiceOver)
- WCAG audit yearly (3rd party)
- User testing with disability community

### 14.5. Plagiarism detection

**Use case:** Detect cheating in exams (essay answers) and unoriginal content uploads.

**Stack (Stage 3):**
- **Internal corpus check:** compare against user's own past work
- **Cross-user check (anonymized):** detect collusion
- **Public corpus check:** Turnitin API or Copyleaks ($$$)
- **AI-generated detection:** GPTZero / Originality.ai (with caveat AI detection unreliable)

**Implementation:**
```
Essay submitted →
  Pipeline:
    ├→ Tokenize + normalize
    ├→ Embed via Voyage (1024-dim)
    ├→ Check internal Qdrant (user's history)
    ├→ Check public corpus (Turnitin API)
    ├→ LLM judgment (writing style consistency)
    └→ Score 0-100% + flagged passages
```

**Action on detection:**
- Score < 30%: flag for teacher review
- Score 30-70%: warning + require justification
- Score > 70%: rejected, teacher notified

**Caveat:** AI detection is **unreliable** in 2026 (false positive 20-30%). Don't use as sole evidence — always teacher judgment.

### 14.6. Teacher / admin tools

**Teacher dashboard (Stage 2):**
- Class roster
- Assignment management
- Exam creation + grading
- Student progress overview
- Communication (announcement, message)

**Admin tools (Stage 3, enterprise):**
- User provisioning (CSV upload, SCIM)
- Bulk actions (create classes, assign teachers)
- Org analytics (school-wide)
- License management (seats, expiry)
- Custom branding (white-label option for Enterprise tier)

**Integrations (Stage 3):**
- LMS: Canvas, Moodle, Google Classroom (LTI 1.3)
- SIS: PowerSchool, Infinite Campus
- SSO: Google Workspace, Microsoft 365
- LRS: xAPI for learning analytics

### 14.7. Cogniva-specific exam infrastructure

**Live exam (Phase 17 from plan-rooms-and-exam.md, scale considerations):**

**At 10K concurrent exam participants:**
- WS state per participant: ~10KB → 100MB total (fits Redis)
- Question delivery: pre-load all questions in browser (10-50KB)
- Answer submit: 1 POST per question → 10K * Q req/s burst
- Need: rate limit + batching, queue-based dispatch

**At 100K concurrent:**
- DurableObject per exam room (Cloudflare)
- Sharding: 1000 participants per DO
- Event sourcing: all answers append-only
- Final grading: batch job, eventual consistency OK

**Anti-cheat at scale:**
- Browser fingerprint server-side validate
- Webcam frame upload (rate limited)
- Statistical analysis batch (post-exam)
- Manual review queue (top 1% suspicious)

### 14.8. Adaptive testing (IRT, Phase 18)

**Item Response Theory infrastructure:**
- Calibrate item difficulty + discrimination via 1000+ responses
- Real-time ability estimation (CAT - Computer Adaptive Testing)
- Bank of 10K+ items per subject for non-repetition

**Scaling concern:**
- Item parameter recomputation: weekly batch
- Real-time CAT: sub-100ms inference (load params to Redis, compute next item)
- ML model: item parameter prediction from text (cold-start)

### 14.9. Content moderation in education

**Special considerations vs generic SaaS:**
- Lower threshold for inappropriate content (minors present)
- Academic integrity violations (cheating, AI ghostwriting)
- Bullying detection (peer-to-peer chat in rooms)
- Mental health flags (self-harm references in essays)

**Action playbook:**
- Auto-mute + parent notification for under-13
- Teacher escalation for academic concerns
- Mandatory reporting (some jurisdictions: child abuse, threats)
- School admin dashboard for incident review

### 14.10. Educational outcomes measurement

**Beyond engagement metrics — actual learning:**
- Pre/post knowledge assessment per concept
- Standardized test score correlation (where available)
- Long-term retention test (60-day follow-up)
- Self-reported confidence vs actual performance

**Research collaboration (Stage 3+):**
- Partner with universities (Stanford CME, MIT, VNU)
- IRB-compliant studies on learning outcomes
- Anonymized data sharing for research
- Publish findings (peer-reviewed, builds credibility)

---

## 15. Phase Roadmap — 18 tháng

### 15.1. Stage 1: Foundation (M1-M3, 0 → 5K MAU)

**Team: 1-2 eng. Budget: $1-3K/mo infra. Goal: Stop bleeding, foundation cho Stage 2.**

#### M1: Critical infrastructure debt

**W1-2: Multi-instance safety**
- [ ] Migrate in-memory rate limiter → Upstash Redis
- [ ] Better Auth: switch session storage Postgres → Redis (or JWT + Redis revocation list)
- [ ] Add `traceId` middleware (Sentry + Langfuse correlation)
- [ ] Setup PostHog feature flags (release.* prefix)

**W3-4: Database scaling foundation**
- [ ] Neon: add 2 read replicas (EU, APAC region)
- [ ] App: route `SELECT` queries to read replica (Drizzle replica mode)
- [ ] Setup pgBouncer (transaction mode) in front of Postgres
- [ ] Postgres: add hot-path indexes (audit pg_stat_statements)
- [ ] Partition `room_message` + `review` tables by month

**Deliverable M1:**
- ✅ Stack vẫn handle 50 RPS sustained
- ✅ No more "rate limit reset on deploy"
- ✅ DB connection count < 100 even at peak
- ✅ Replica lag < 1s P95

#### M2: Observability + Cost guardrails

**W5: Observability stack**
- [ ] Sentry (frontend + backend) — already in place, audit completeness
- [ ] Langfuse traces for all LLM calls
- [ ] Better Stack logs (structured JSON)
- [ ] Grafana dashboards (synthetic from Better Stack metrics)
- [ ] Define 10 critical SLOs

**W6: Cost guardrails**
- [ ] Per-user AI quota (free: $0.50/day, pro: $5/day)
- [ ] Cost circuit breaker (alarm at 80% budget burn)
- [ ] AI cost tracking dashboard
- [ ] Implement Anthropic prompt caching (90% cost saving on long prompts)
- [ ] Semantic cache for repeated queries (5min TTL)

**W7: Backup + DR**
- [ ] Daily Neon backup → R2 cold storage
- [ ] First DR drill (PITR restore to staging from yesterday's backup)
- [ ] Document RTO/RPO targets
- [ ] Quarterly DR drill scheduled

**W8: Load testing baseline**
- [ ] k6 baseline tests (1K concurrent users)
- [ ] Capacity model documented
- [ ] Bottleneck identified + ranked
- [ ] CI/CD: lighthouse check on every PR

**Deliverable M2:**
- ✅ Cost per active user / month: known with telemetry
- ✅ Sentry critical alerts < 5/week
- ✅ Successful DR drill
- ✅ Load test pass: 1K concurrent, 50 req/s

#### M3: Compliance baseline + Hiring

**W9-10: Compliance baseline**
- [ ] Privacy policy (lawyer-reviewed)
- [ ] Terms of Service
- [ ] Cookie consent banner (essential / functional / marketing)
- [ ] DPA template
- [ ] Sub-processor list (Anthropic, Voyage, Cohere, Vercel, etc.)
- [ ] GDPR data export endpoint (`POST /api/account/export`)
- [ ] GDPR data delete endpoint
- [ ] Audit log infrastructure (table + middleware)

**W11-12: Hiring + Onboarding**
- [ ] Job posting: DevOps/SRE (P0)
- [ ] Job posting: Senior eng (P0)
- [ ] Onboarding runbook (week 1, 2, 4)
- [ ] Tech radar published (what tech we use + why)

**Deliverable M3:**
- ✅ EU users legally onboardable
- ✅ Audit log of every PII access
- ✅ 1 DevOps hired or in pipeline
- ✅ Ready to enter Stage 2

### 15.2. Stage 2: Geographic Distribution (M4-M12, 5K → 100K MAU)

**Team: 5-8 eng. Budget: $15-40K/mo. Goal: Multi-region, mobile, service extraction.**

#### M4-M5: Edge & Geographic

**Critical path:**
- [ ] Cloudflare Workers edge gateway
  - JWT verify
  - Rate limit (Durable Objects)
  - Geo-IP routing
  - Feature flag eval
- [ ] Cloudflare Workers KV for global config
- [ ] Cloudflare Images for image resize
- [ ] Anycast DNS (Cloudflare default)
- [ ] HTTP/3 enabled origin

**Deliverable M5:**
- ✅ Auth latency < 50ms global (edge JWT verify)
- ✅ P95 API < 250ms regional
- ✅ Edge cache hit rate > 60% for static

#### M6-M7: Mobile launch

**Critical path:**
- [ ] React Native + Expo project setup
- [ ] Shared types/utils package
- [ ] Core flows: signup, document upload, flashcard review, mastery dashboard
- [ ] Offline-first sync (WatermelonDB)
- [ ] Push notifications (Expo Notifications)
- [ ] iOS App Store + Google Play submission

**Deliverable M7:**
- ✅ Mobile shipped iOS + Android
- ✅ Day 1 of mobile launch: 1K download
- ✅ Mobile DAU > 20% web DAU within 4 weeks

#### M8: LiveKit cluster + AI service extract

**LiveKit cluster:**
- [ ] LiveKit 2-region (SG + FRA)
- [ ] Cascading SFU mesh
- [ ] coturn 2-region

**AI service extraction:**
- [ ] Extract `lib/ai/*` into separate Fly.io service
- [ ] gRPC or REST internal API
- [ ] Service-to-service auth (mTLS or JWT)
- [ ] Independent deployment + scaling

**Deliverable M8:**
- ✅ Video RTT < 100ms intra-region
- ✅ AI service deployable independently of web app
- ✅ AI cost down 20% (caching + routing improvements)

#### M9: Analytics infrastructure

**ClickHouse setup:**
- [ ] ClickHouse Cloud (or self-host Hetzner)
- [ ] Event schema migration from PostHog free
- [ ] Inngest batch insert pipeline
- [ ] dbt project for transformations
- [ ] Grafana dashboards on ClickHouse

**Event taxonomy:**
- [ ] Event spec doc written
- [ ] TS types for all events
- [ ] Backfill historical events
- [ ] Replace PostHog free with own pipeline

**Deliverable M9:**
- ✅ Real-time dashboard (event → query < 10s)
- ✅ Cost analysis per-feature breakdown
- ✅ Funnel + cohort visible

#### M10-M11: Notification + Chat extraction

**Notification service (Go):**
- [ ] Extract transactional + lifecycle email
- [ ] Knock integration (or self-built dispatcher)
- [ ] Channel preferences UI
- [ ] Frequency caps + quiet hours

**Chat service (Go):**
- [ ] Extract WS handling + message persistence
- [ ] Centrifugo evaluation (vs stay Soketi)
- [ ] Migration path documented

**Deliverable M11:**
- ✅ Email deliverability > 99%
- ✅ Chat msg latency P95 < 100ms
- ✅ Web app downscaled (less responsibility)

#### M12: SOC2 Type 1 + Compliance

**SOC2 Type 1 audit:**
- [ ] Drata/Vanta setup
- [ ] Policies written + signed (~30 policies)
- [ ] Access review process
- [ ] Vendor risk assessments
- [ ] Penetration test (Cure53 or similar)
- [ ] Auditor engagement (1 month audit)

**Additional compliance:**
- [ ] FERPA review (for US schools)
- [ ] COPPA mechanism (parental consent flow)
- [ ] CCPA notice (California)

**Deliverable M12:**
- ✅ SOC2 Type 1 cert obtained
- ✅ Enterprise sales unblocked
- ✅ 100K MAU sustained (success metric Stage 2)

### 15.3. Stage 3: Microservices Mesh (M13-M18+, 100K → 1M MAU)

**Team: 12-20 eng. Budget: $80-200K/mo. Goal: Big-tech-grade infrastructure.**

#### M13-M14: Room + Exam service extraction

- [ ] Room service (Go) extracted
- [ ] Exam service (Go) extracted
- [ ] Service mesh evaluation (Linkerd)
- [ ] Event backbone setup (Redpanda)

#### M15-M16: Data layer evolution

- [ ] Qdrant migration evaluation (only if pgvector bottleneck)
- [ ] Neon multi-region writes (preview)
- [ ] CockroachDB decision (only if needed)
- [ ] DragonflyDB self-host for hot cache

#### M17: AI self-host

- [ ] vLLM cluster (Llama 3.3 70B on Modal/RunPod)
- [ ] AWQ INT4 quantization
- [ ] Multi-tenant prefix caching
- [ ] Route low-priority workload to self-host (50% AI cost saving)

#### M18: SOC2 Type 2 + Chaos engineering

- [ ] SOC2 Type 2 audit (after 6 months Type 1)
- [ ] HIPAA-ready certification (healthcare ed-tech partners)
- [ ] Chaos engineering automated (weekly tests)
- [ ] Multi-region active-active complete

**Deliverable M18:**
- ✅ 99.95% uptime achieved 6 months
- ✅ 200K MAU sustained
- ✅ SOC2 Type 2 cert
- ✅ Multi-region active-active

### 15.4. Beyond M18 (vision)

- M19-24: 1M MAU push, full mobile features
- M25-30: International expansion (3+ languages)
- M30+: Acquisition/IPO readiness

---

## 16. Team & Hiring

### 16.1. Team growth plan

| Phase | Month | Team size | Critical hires |
|---|---|---|---|
| Stage 1 start | M0 | 1-2 (founder + helper) | — |
| Stage 1 mid | M2 | 3 | +DevOps/SRE |
| Stage 1 end | M3 | 4-5 | +Senior Backend, +Designer |
| Stage 2 early | M5 | 7-8 | +Senior Frontend, +Mobile (RN), +ML/Data |
| Stage 2 mid | M9 | 10-12 | +Backend Go, +SRE2, +Support manager, +Marketing |
| Stage 2 end | M12 | 15 | +Security, +Sales (enterprise), +Customer Success |
| Stage 3 early | M14 | 18-20 | +SRE3, +Backend Go2, +ML eng, +Designer 2 |
| Stage 3 mid | M16 | 25-30 | +Full SRE team, +Eng manager, +Product manager |
| Stage 3 end | M18 | 35-50 | +T&S team, +Legal/Compliance, +DevRel |

### 16.2. Critical hires detailed

#### Hire #1: DevOps / SRE (M2)

**Why first:** founder can't be on-call 24/7. Infra ops eats 30% of dev time.

**Profile:**
- 5+ years infra (AWS/GCP/Vercel)
- Postgres expert (PITR, replication, tuning)
- Observability (Grafana, Sentry, Langfuse)
- CI/CD pipelines (GitHub Actions, ArgoCD)
- Security baseline knowledge

**Salary range (VN remote-friendly):**
- VN: ₫50-90M/mo ($2-3.7K)
- SEA: $3-5K/mo
- US/EU remote: $8-12K/mo

#### Hire #2: Senior Backend (M3)

**Why:** monolith hardening needs depth.

**Profile:**
- TypeScript/Node + at least one of Go/Rust
- Postgres + Redis + Kafka background
- Distributed systems patterns
- Production scale experience (10K+ RPS)

**Salary:** similar to DevOps

#### Hire #3-4: Frontend + Mobile (M5)

**Frontend:**
- React + Next.js production scale
- Performance optimization (LCP, INP)
- Animation, accessibility

**Mobile (RN):**
- React Native + Expo
- Native module integration
- iOS + Android publishing
- Offline-first patterns

#### Hire #5: ML / Data eng (M5)

**Profile:**
- RAG production experience
- Eval framework (RAGAS, golden datasets)
- Embedding + vector DB
- Prompt engineering

**Why now:** AI is core moat, can't outsource

#### Hire #6: SRE2 + Backend Go (M9)

**As traffic grows past 50K MAU, need:**
- Dedicated SRE rotation (no founder pager)
- Go expertise for service extraction

#### Hire #7: Security eng (M12)

**Why:** SOC2 + enterprise sales requires
- AppSec background
- Compliance experience (SOC2, ISO 27001)
- Incident response
- Pentest coordination

### 16.3. Engineering culture

**Trunk-based development:**
- Main always deployable
- Short PRs (< 400 LOC ideal)
- Feature flags for incomplete work
- No long-running release branches

**Code review:**
- All PR require 1 approval (2 for security/infra changes)
- Bot suggestions for style (let humans review logic)
- Review SLA: < 4h business hours

**Testing:**
- Unit: > 70% coverage for business logic
- Integration: critical paths must have
- E2E: smoke tests for top user flows
- Eval: AI components have eval gate

**Documentation:**
- README per service
- Runbook per service (oncall guide)
- Architecture Decision Records
- API docs (OpenAPI auto-gen)

**On-call:**
- Stage 1: founder only
- Stage 2: rotation among 3-5 SRE/senior
- Stage 3: 1 primary + 1 backup, weekly rotation
- Compensation: $200-500/week on-call

**Post-mortems:**
- Blameless format
- Within 48h of SEV1/2
- Action items with owners + due dates
- Shared company-wide

**Hiring philosophy:**
- Hire generalists in Stage 1
- Specialists in Stage 2+
- Remote-first, async-friendly
- Cultural fit: humble + curious + ownership

---

## 17. Budget & Cost Projection (revised, grounded)

### 17.1. Cost by stage

| Phase | Users (MAU) | Infra cost/mo | LLM cost/mo | Tools/mo | Total/mo |
|---|---|---|---|---|---|
| MVP M0 | 100 | $200 | $200 | $50 | $450 |
| Stage 1 end M3 | 5K | $1,800 | $2,500 | $300 | $4,600 |
| Stage 2 mid M8 | 30K | $8,000 | $12,000 | $1,500 | $21,500 |
| Stage 2 end M12 | 100K | $20,000 | $30,000 | $4,000 | $54,000 |
| Stage 3 mid M15 | 300K | $50,000 | $50,000 | $7,000 | $107,000 |
| Stage 3 end M18 | 600K | $100,000 | $80,000 | $12,000 | $192,000 |

**Note:** v1 plan over-estimated MAU (1M in 12 months) and under-estimated cost per user. v2 corrected.

### 17.2. Detailed breakdown M12 (100K MAU)

| Category | Item | Cost/mo |
|---|---|---|
| **Compute** | Vercel Pro (50 seats teams) | $1,000 |
| | Fly.io (10 services x 3 regions) | $3,000 |
| | Hetzner dedicated (3 servers) | $300 |
| | Modal/RunPod GPU (sporadic) | $500 |
| **Database** | Neon Pro multi-region | $2,500 |
| | Redis/DragonflyDB | $300 |
| | ClickHouse Cloud | $800 |
| | Qdrant (if migrated) | $500 |
| **Storage** | R2 (10TB stored, free egress) | $150 |
| | Backup (Backblaze B2) | $50 |
| **Realtime** | LiveKit cluster 2-region | $400 |
| | Soketi/Centrifugo self-host | $80 |
| | Hocuspocus | $40 |
| **Edge** | Cloudflare Workers Paid | $200 |
| | Cloudflare Images | $100 |
| | Cloudflare R2 (already above) | — |
| | Cloudflare Argo Smart Routing | $300 |
| **AI** | Anthropic Sonnet + Opus + Haiku | $20,000 |
| | OpenAI (Whisper + fallback) | $3,000 |
| | Voyage AI embeddings | $1,500 |
| | Cohere rerank | $1,500 |
| | Self-host LLM (Stage 3 start) | $4,000 |
| **Observability** | Sentry Business | $300 |
| | Langfuse Cloud | $200 |
| | Better Stack Logs | $500 |
| | Grafana Cloud | $300 |
| **Compliance** | Drata | $1,000 |
| | Pentest (amortized $40K/yr) | $3,300 |
| **Customer ops** | Plain | $200 |
| | Knock notifications | $200 |
| | Statuspage | $100 |
| **Email** | Postmark + Customer.io | $400 |
| **Misc** | Domains, SSL, dev tools | $300 |
| | Stripe fees (2.9% + 30¢) | (revenue %) |
| | **Total** | **~$46,000** + AI = **~$54K** |

### 17.3. Revenue & gross margin

**Cogniva pricing (VN-localized + global):**

| Tier | VN price | Global USD | Target % users |
|---|---|---|---|
| Free | ₫0 | $0 | 80% |
| Pro | ₫149K | $9 | 15% |
| Team (5 seats) | ₫599K | $35 | 4% |
| School (Enterprise) | Custom | $500+/mo | 1% |

**At 100K MAU (M12):**
- Free: 80K * $0 = $0
- Pro: 15K * $9 avg = $135K MRR
- Team: 4K * $35 = $140K MRR
- School: 100 orgs * $1000 = $100K MRR
- **Total: $375K MRR ($4.5M ARR)**
- **Infra cost: $54K (14% of revenue)**
- **Gross margin: 86%**

**At 600K MAU (M18):**
- Pro: 90K * $9 = $810K
- Team: 24K * $35 = $840K
- School: 600 * $1500 = $900K
- **Total: $2.55M MRR ($30.6M ARR)**
- **Infra cost: $192K (7.5% of revenue)**
- **Gross margin: 92%**

**Reality check:** v1 plan assumed 25% Pro conversion → 5% in v2 is realistic (Notion 5%, Linear 10%). VN market may have lower conversion (~3-5%) than US (~7-10%).

### 17.4. Cost optimization tactics

**LLM cost (biggest line item):**
- Anthropic prompt caching: 90% savings on system prompts (recurring chunks)
- Semantic caching: 30% answer cache hit
- Model routing: Haiku for cheap tasks (60% of calls), Sonnet for critical
- Self-host vLLM for batch (chunking, classification): -70% vs Sonnet
- Per-user quota: stops runaway
- Aggressive output max_tokens limit

**Compute:**
- Reserved instances 1-year (-40%)
- Spot instances batch/dev (-70%)
- Auto-scale down off-peak hours (VN 2am-6am)
- Bundle small services on shared VM

**Database:**
- Read replica for analytics queries (off primary)
- Partition cold data → cheaper tier
- Archive > 1 year → R2 Glacier
- ClickHouse for OLAP (10x cheaper than Postgres for aggregations)

**Storage:**
- R2 over S3 (free egress)
- Lifecycle: hot → cold → archive
- Compression (Brotli/Zstd) for backups
- Dedup (perceptual hash) for user uploads

**CDN:**
- Cache aggressive (60s default for public API)
- Stale-while-revalidate (serve stale, refresh async)
- Image lazy load + responsive sizes
- Font subset (50% size reduction)

---

## 18. Migration Strategy

### 18.1. Strangler fig pattern

**Pattern:**
1. Identify bounded context
2. Build new system parallel
3. Dual-write (both systems)
4. Validate consistency
5. Shift read traffic gradually
6. Shift write traffic
7. Decommission old after stability

**KHÔNG bao giờ:**
- Big-bang cutover
- Rewrite-from-scratch
- Pause new features for migration
- Migrate without rollback plan

### 18.2. Database migration patterns

#### 18.2.1. Postgres schema migration (online)

**Add column nullable:**
```sql
-- Safe, instant on most modern Postgres
ALTER TABLE flashcard ADD COLUMN difficulty_v2 real NULL;
```

**Add column with default:**
```sql
-- Postgres 11+: instant for fixed default
ALTER TABLE flashcard ADD COLUMN region text DEFAULT 'APAC';

-- For computed default, backfill in batches
ALTER TABLE flashcard ADD COLUMN slug text NULL;
-- Then Inngest job to backfill 1000 rows at a time
```

**Drop column:**
```
Step 1: Update app code to stop writing column
Step 2: Deploy, wait 1 week (verify no writes in logs)
Step 3: Update app code to stop reading column
Step 4: Deploy, wait 1 week
Step 5: DROP COLUMN
```

**Rename column:**
```
Step 1: Add new column nullable
Step 2: Dual-write both columns
Step 3: Backfill new column from old
Step 4: Switch reads to new column
Step 5: Stop writing old column
Step 6: Drop old column
```

#### 18.2.2. Cross-database migration (Postgres → CockroachDB)

**Only if needed (multi-region writes hard constraint).**

```
Phase 1: Setup (1 week)
- CockroachDB cluster provisioned
- Schema match (handle FK differences)
- Logical replication: Postgres → Cockroach (debezium → Kafka → cockroach sink)

Phase 2: Dual-write (2 weeks)
- App writes both DBs
- Reads still from Postgres
- Monitor: row count, content match

Phase 3: Shadow reads (1 week)
- 1% reads go to Cockroach
- Compare results with Postgres
- Acceptable diff: < 0.01%

Phase 4: Read shift (2 weeks)
- 1% → 10% → 50% → 100% reads from Cockroach
- Stop writes to Postgres
- Monitor errors closely

Phase 5: Decommission (1 week)
- Verify no app code uses Postgres
- Backup final state
- Keep Postgres read-only 30 days for rollback
- Then shut down
```

**Estimated time: 6-8 weeks for major DB migration. Don't rush.**

### 18.3. Service extraction pattern

**Step-by-step:**

```
1. Identify bounded context
   - "Notification" all email + push + in-app
   - Tables: notification_template, notification_log
   - APIs: /api/notifications/*
   
2. Document current behavior
   - Capture all endpoint contracts
   - Write API spec (OpenAPI)
   - List all consumers (web app, mobile, etc.)

3. Build new service parallel
   - New repo: services/notification
   - Same API surface
   - Reuse types from shared package
   - Database: still shared with monolith (DB split is separate concern)

4. Set up infrastructure
   - Fly.io machines
   - Deployment pipeline
   - Monitoring + alerts

5. Feature flag route
   - Web app: read flag, route 1% notification to new service
   - Compare logs (both services log identical input/output)
   - Catch divergences

6. Increase traffic
   - 1% → 5% → 25% → 50% → 100%
   - Each step: 2-3 days observation
   - Total: 2-3 weeks

7. Decommission old code
   - Remove notification code from monolith
   - Database tables remain (will split DB later)
   - Update docs
```

**Anti-patterns:**
- Extracting service while DB still tightly coupled → distributed monolith
- Extracting too many services at once → too many failure modes
- Extracting without monitoring → can't debug issues

### 18.4. Risk mitigation patterns

#### 18.4.1. Reversibility

**Every migration must answer:**
1. How do we roll back if something breaks?
2. What's the MTTR for rollback?
3. What's the data loss tolerance?

**Implementation:**
- Feature flag for instant disable
- Database changes always reversible (down migration tested)
- Data backfill jobs have undo (track what was changed)
- Code changes deployable as revert (not just hotfix)

#### 18.4.2. Observability before during after

- Baseline metrics 2 weeks before migration
- Real-time dashboard during migration
- Compare post-migration metrics
- Alert on regression > 10% any SLI

#### 18.4.3. Customer communication

- Major changes: email customers 2 weeks advance
- Maintenance windows: 1 week advance + status page
- Unplanned issues: status page within 5min
- Post-incident: customer summary (if user-impacting)

#### 18.4.4. Migration test harness

```typescript
// Comparison framework
async function shadowCompare<T>(
  primary: () => Promise<T>,
  shadow: () => Promise<T>,
  diff: (a: T, b: T) => string | null,
  context: { feature: string; userId: string },
): Promise<T> {
  const [primaryResult, shadowResult] = await Promise.allSettled([
    primary(),
    shadow(),
  ]);
  
  if (primaryResult.status === 'rejected') throw primaryResult.reason;
  
  if (shadowResult.status === 'fulfilled') {
    const d = diff(primaryResult.value, shadowResult.value);
    if (d) {
      logger.warn('shadow.divergence', { ...context, diff: d });
      metric('shadow.divergence', 1, { feature: context.feature });
    }
  } else {
    logger.warn('shadow.error', { ...context, error: shadowResult.reason });
  }
  
  return primaryResult.value;
}
```

### 18.5. Backfill strategies

**Problem:** Schema changes need backfill for historical data.

**Pattern A: Lazy backfill (read-time)**
```typescript
// On read, compute missing field
async function getFlashcard(id: string) {
  const card = await db.query.flashcard.findFirst({ where: eq(flashcard.id, id) });
  if (!card.region) {
    // Compute + cache
    card.region = await computeRegion(card.user_id);
    await db.update(flashcard).set({ region: card.region }).where(eq(flashcard.id, id));
  }
  return card;
}
```
**Use when:** Cold data acceptable to leave un-backfilled.

**Pattern B: Async background backfill**
```typescript
// Inngest job processes in batches
inngest.createFunction(
  { id: 'backfill-flashcard-region' },
  { cron: '*/5 * * * *' }, // every 5min
  async ({ step }) => {
    const batch = await db.query.flashcard.findMany({
      where: isNull(flashcard.region),
      limit: 1000,
    });
    for (const card of batch) {
      const region = await computeRegion(card.user_id);
      await db.update(flashcard).set({ region }).where(eq(flashcard.id, card.id));
    }
  }
);
```
**Use when:** All data needs backfill, can be slow.

**Pattern C: Synchronous online migration**
```bash
# pg-online-migration tool
pg-online-migration \
  --table flashcard \
  --add-column region \
  --compute "SELECT user_region(user_id) FROM user WHERE user.id = flashcard.user_id" \
  --batch-size 1000 \
  --pause-ms 100
```
**Use when:** Have downtime budget, simple data.

### 18.6. Migration patterns library

**Patterns we've used (build library over time):**
1. ✅ In-memory → Redis cache (M1 W1)
2. ✅ DB session → JWT (M1 W2)
3. ✅ Postgres single → read replicas (M1 W3)
4. ✅ Sync inline → Inngest async (Phase 1 multi-times)
5. ⏳ Local storage → R2 (Phase 1)
6. ⏳ Soketi → Centrifugo (Stage 2 contingent)
7. ⏳ pgvector → Qdrant (Stage 3 contingent)
8. ⏳ Monolith → microservice extract (Stage 2-3)
9. ⏳ Single region → multi-region (Stage 2)
10. ⏳ Postgres → CockroachDB (Stage 3 contingent)

Each pattern documented with: trigger, prerequisites, steps, rollback, lessons learned.

---

## 19. Risk Register

> Top 30 rủi ro tracked qua phase. Mỗi risk có Likelihood × Impact = Score, Mitigation, Owner, Review Date.

### 19.1. Technical risks

| # | Risk | L (1-5) | I (1-5) | Score | Mitigation | Owner | Review |
|---|---|---|---|---|---|---|---|
| T1 | Vercel function timeout 10min kills long AI streams | 5 | 4 | 20 | Migrate AI service to Fly.io M8 | Backend | M5 |
| T2 | Soketi single-node failure → realtime down | 3 | 5 | 15 | 2-replica cluster + monitor health | DevOps | M2 |
| T3 | LiveKit single-node bandwidth saturated | 4 | 4 | 16 | Multi-region cluster M5-6 | DevOps | M5 |
| T4 | Postgres connection pool exhausted | 4 | 5 | 20 | pgBouncer + connection limits M1 | DevOps | M1 |
| T5 | pgvector slow at > 50M chunks | 3 | 3 | 9 | Benchmark + plan Qdrant migration | ML | M9 |
| T6 | Hocuspocus in-memory state lost on restart | 3 | 3 | 9 | Persistent state + reconnect handlers | Backend | M4 |
| T7 | Redis cache stampede on miss | 4 | 3 | 12 | Lock + stale-while-revalidate pattern | Backend | M2 |
| T8 | Embedding API rate limit (Voyage 3 RPM free) | 5 | 3 | 15 | Paid tier or batch + retry backoff | ML | M1 |
| T9 | Inngest job queue backlog | 3 | 4 | 12 | Capacity planning + alerting | DevOps | M4 |
| T10 | Database migration breaks production | 3 | 5 | 15 | Online migration + tested rollback | Backend | ongoing |

### 19.2. AI/ML risks

| # | Risk | L | I | Score | Mitigation | Owner | Review |
|---|---|---|---|---|---|---|---|
| A1 | LLM provider outage (Anthropic down) | 4 | 5 | 20 | Multi-provider fallback chain | AI lead | M3 |
| A2 | AI cost runaway (bug or attack) | 5 | 5 | 25 | Per-user quota + circuit breaker M2 | Backend | M2 |
| A3 | Prompt injection compromises tutor | 4 | 4 | 16 | Layered moderation, system prompt hardening | AI lead | M6 |
| A4 | Hallucination misleads students | 5 | 5 | 25 | Eval gate + citation enforcement + disclaimer | AI lead | ongoing |
| A5 | Embedding model deprecated mid-use | 2 | 4 | 8 | Version field in schema, dual-write migration plan | ML | M9 |
| A6 | FSRS predictions inaccurate per subject | 4 | 3 | 12 | Per-subject calibration + A/B vs SM-2 | ML | M9 |
| A7 | RAG retrieval misses critical chunks | 4 | 4 | 16 | Hybrid search + rerank + eval golden | ML | M6 |
| A8 | Whisper transcription fails for VN accent | 3 | 3 | 9 | Self-host whisper-large-v3 + locale tuning | ML | M9 |

### 19.3. Business / operational risks

| # | Risk | L | I | Score | Mitigation | Owner | Review |
|---|---|---|---|---|---|---|---|
| B1 | Founder burnout (single point of failure) | 5 | 5 | 25 | Hire DevOps M2, distribute on-call | CEO | M2 |
| B2 | Hiring delay blocks scaling | 4 | 4 | 16 | Start hiring M1, use recruiter agency | CEO | M1 |
| B3 | Funding runway < 6 months | 3 | 5 | 15 | Budget watch + revenue tracking | CEO | monthly |
| B4 | Competitor (Quizlet, Notion AI) launches faster | 4 | 4 | 16 | Focus VN moat + ed-tech vertical | Product | quarterly |
| B5 | VN MOET regulation change | 2 | 4 | 8 | Legal advisor, regulatory monitoring | Legal | quarterly |
| B6 | Pricing too low (negative margin) | 3 | 4 | 12 | Monitor LTV/CAC, pricing experiments | Product | monthly |
| B7 | Churn rate > 10%/mo | 4 | 5 | 20 | Lifecycle marketing + product improvements | Product | weekly |

### 19.4. Compliance / legal risks

| # | Risk | L | I | Score | Mitigation | Owner | Review |
|---|---|---|---|---|---|---|---|
| C1 | GDPR violation (EU user complaint) | 3 | 5 | 15 | Legal review, DSR endpoints, audit log | Legal | M3 |
| C2 | FERPA violation (US school) | 2 | 5 | 10 | Compliance setup M12 before US sales | Legal | M12 |
| C3 | COPPA violation (under-13) | 3 | 5 | 15 | Age verification flow, parental consent | Product | M6 |
| C4 | Data breach (PII leak) | 2 | 5 | 10 | Encryption, access audit, security baseline | Security | quarterly |
| C5 | DMCA takedown (copyrighted textbook) | 4 | 3 | 12 | DMCA process, content filter | T&S | M9 |
| C6 | User-generated harassment in rooms | 4 | 4 | 16 | Moderation, reporting, T&S team M12+ | T&S | M9 |

### 19.5. Infrastructure risks

| # | Risk | L | I | Score | Mitigation | Owner | Review |
|---|---|---|---|---|---|---|---|
| I1 | Vercel pricing change (cost spike) | 3 | 3 | 9 | Cost monitoring, Fly.io ready as alt | DevOps | quarterly |
| I2 | Cloudflare global outage | 2 | 5 | 10 | DR plan, secondary DNS | DevOps | M6 |
| I3 | Neon serverless cold start latency | 3 | 3 | 9 | Min compute = 1 (no scale to zero) | DevOps | M2 |
| I4 | DDoS attack | 3 | 4 | 12 | Cloudflare WAF + rate limit | Security | quarterly |
| I5 | DNS hijack | 1 | 5 | 5 | Registrar lock + DNSSEC | DevOps | yearly |

**Total scored risks: 30**

**High-priority (Score > 15) require:**
- Monthly review in eng all-hands
- Documented mitigation status
- Owner accountability
- Escalation if score increases

---

## 20. Architecture Decision Records (ADRs)

> ADR format: Context / Decision / Consequences / Status / Date

### ADR-001: Use Next.js + Postgres monolith for Stage 1

**Context:** Need to ship MVP fast with small team. Many architecture options: serverless functions, microservices, Rails, etc.

**Decision:** Next.js 15 monolith + Neon Postgres + Vercel deployment.

**Consequences:**
- ✅ Single codebase, fast iterate
- ✅ Vercel managed (no ops overhead)
- ✅ Postgres mature, transactional safe
- ❌ Function timeout (10min) limits long AI streams
- ❌ Monolith scaling needs effort later

**Status:** Accepted (current)
**Date:** 2025-12

### ADR-002: Defer microservices until Stage 2 mid

**Context:** Scale-up plan v1 proposed 12 services at start. Industry trend: "microservices = best practice."

**Decision:** Stay monolith until M7-M8. Extract Notification + AI + Chat services in Stage 2 only when pain emerges.

**Consequences:**
- ✅ Avoid premature distribution complexity
- ✅ Team can deliver features fast
- ✅ Operations cost low
- ❌ Will have refactor work later
- ❌ Some service boundaries hard to draw retroactively

**Status:** Accepted
**Date:** 2026-05

### ADR-003: Self-host Soketi over Pusher Cloud

**Context:** Need WS pub/sub. Pusher Cloud $49/mo basic, Soketi self-host $20/mo VPS.

**Decision:** Soketi self-host (current) until > 100K concurrent WS or feature limit.

**Consequences:**
- ✅ Cost: $20 vs $499 at scale (Pusher)
- ✅ Full control, no vendor lock
- ❌ Ops burden (monitor, upgrade)
- ❌ Need fallback when down

**Status:** Accepted (current)
**Date:** 2026-04

### ADR-004: Use LiveKit over Daily/Twilio for WebRTC

**Context:** Need WebRTC SFU for rooms. Options: LiveKit (self-host or cloud), Daily, Twilio Video, Agora.

**Decision:** LiveKit self-host (current) → LiveKit Cloud for Stage 2 cluster if ops burden too high.

**Consequences:**
- ✅ Open source, full control
- ✅ Best-in-class SDK
- ✅ Self-host saves $$$ at scale
- ❌ Ops complexity (cluster setup)
- ❌ Bandwidth cost on VPS

**Status:** Accepted (current)
**Date:** 2026-04

### ADR-005: pgvector instead of Qdrant from Day 1

**Context:** RAG needs vector search. Options: pgvector, Qdrant, Pinecone, Weaviate.

**Decision:** pgvector with HNSW. Migrate Qdrant only when proven bottleneck (Stage 3).

**Consequences:**
- ✅ Single DB simplicity
- ✅ Hybrid query (vector + SQL) easy
- ✅ Postgres transactional consistency
- ❌ Performance ceiling ~100-200M chunks
- ❌ Less feature-rich than Qdrant

**Status:** Accepted (current)
**Date:** 2026-02

### ADR-006: React Native + Expo for mobile (not native)

**Context:** Need mobile app. Options: React Native, Flutter, native iOS+Android, PWA only.

**Decision:** React Native + Expo + EAS, ship M6-M7.

**Consequences:**
- ✅ 70% code reuse with web
- ✅ Fast iterate (OTA updates)
- ✅ Smaller team needed (1 mobile eng vs 2 native)
- ❌ Some platform features limited
- ❌ Native module integration occasional pain
- ❌ Smaller pool of expert hires than native

**Status:** Accepted
**Date:** 2026-04

### ADR-007: Vercel AI SDK over LangChain or Mastra full-runtime

**Context:** Need LLM orchestration. Options: AI SDK direct, LangChain, Mastra, custom.

**Decision:** AI SDK + getChatModel (current Phase 3 pattern). Mastra agent runtime only when workflow becomes complex (Phase 18+ adaptive testing).

**Consequences:**
- ✅ Stay close to AI SDK primitives (less abstraction)
- ✅ Simpler code, easier debug
- ❌ Less batteries-included
- ❌ Will rebuild workflow eng later if Mastra would have done it

**Status:** Accepted (current)
**Date:** 2026-05

### ADR-008: Inngest for background jobs (not Bull / SQS)

**Context:** Need durable async jobs. Options: BullMQ, Inngest, AWS SQS+Lambda, Trigger.dev.

**Decision:** Inngest Cloud.

**Consequences:**
- ✅ Best DX (TypeScript-native, step functions)
- ✅ Managed, no Redis ops
- ✅ Built-in observability
- ❌ Vendor lock (mitigated by Inngest export)
- ❌ Cost above free tier

**Status:** Accepted (Phase 1)
**Date:** 2025-12

### ADR-009: Cloudflare R2 over S3

**Context:** Object storage for documents + recordings.

**Decision:** Cloudflare R2 (S3-compatible).

**Consequences:**
- ✅ Zero egress fees (huge for video recording)
- ✅ S3-compatible API
- ✅ Cheaper storage than S3
- ❌ Smaller ecosystem (some tools assume S3)

**Status:** Accepted
**Date:** 2026-02

### ADR-010: Drizzle ORM over Prisma

**Context:** Need TypeScript ORM.

**Decision:** Drizzle.

**Consequences:**
- ✅ SQL-first, less abstraction
- ✅ Faster query perf than Prisma
- ✅ No N+1 issue
- ❌ Less polished migration tooling
- ❌ Smaller community

**Status:** Accepted (pivoted from Prisma)
**Date:** 2025-12

### ADR-011: Better Auth over Clerk/Auth0

**Context:** Need auth solution.

**Decision:** Better Auth (open-source, self-host).

**Consequences:**
- ✅ Self-host control
- ✅ Cheaper at scale
- ✅ Better DX with TypeScript
- ❌ Less mature than Clerk
- ❌ Self-managed = own complexity

**Status:** Accepted (pivoted from Clerk)
**Date:** 2025-12

### ADR-012: PostHog for analytics + feature flags

**Context:** Need analytics and feature flags. Options: Mixpanel + LaunchDarkly, Amplitude + Statsig, PostHog (all-in-one).

**Decision:** PostHog Cloud (free up to 1M events/mo). Migrate to Statsig if experimentation needs grow.

**Consequences:**
- ✅ Single tool for analytics + flags + replay
- ✅ Free tier generous
- ❌ Less specialized than dedicated tools

**Status:** Accepted
**Date:** 2026-03

### ADR-013: TipTap + Yjs for collaborative editing (not Liveblocks)

**Context:** Need collab notes + whiteboard. Options: TipTap+Yjs+Hocuspocus, Liveblocks, Slate+Yjs.

**Decision:** TipTap v3 + Yjs + Hocuspocus self-host.

**Consequences:**
- ✅ Open source, no vendor lock
- ✅ Customizable (extensions)
- ❌ Self-host ops (Hocuspocus single instance bottleneck)
- ❌ Less polished presence vs Liveblocks

**Status:** Accepted
**Date:** 2026-04

### ADR-014: Vietnamese-first internationalization

**Context:** Market entry strategy. Options: English-first global, Vietnamese-first.

**Decision:** Vietnamese-first, English as secondary, expand SEA after PMF.

**Consequences:**
- ✅ Focused market (VN ed-tech less competitive)
- ✅ Better product-market fit for VN
- ❌ Smaller initial TAM
- ❌ Translation overhead later

**Status:** Accepted
**Date:** 2025-12

### ADR-015: Stay on Vercel until Stage 3 (don't multi-cloud early)

**Context:** Hosting strategy. Options: stay Vercel, move to Fly.io, multi-cloud.

**Decision:** Vercel monolith Stage 1. Add Fly.io Stage 2 for extracted services. AWS only Stage 3 if compliance demands.

**Consequences:**
- ✅ DX simplicity
- ✅ One vendor to learn
- ❌ Vercel cost can spike
- ❌ Function timeout limits (mitigated by service extract)

**Status:** Accepted
**Date:** 2026-05

### ADR-016: FSRS over SM-2 for spaced repetition

**Context:** Spaced repetition algorithm. Options: SM-2 (Anki), FSRS-4, FSRS-5, custom.

**Decision:** FSRS-4 as default, A/B SM-2 for sanity, plan FSRS-5 upgrade after stable.

**Consequences:**
- ✅ FSRS scientifically validated, better retention
- ✅ Personalized params possible
- ❌ Less familiar to users from Anki
- ❌ Implementation complexity

**Status:** Accepted (Phase 5)
**Date:** 2026-04

### ADR-017: Self-host LLM only when LLM bill > $10K/mo

**Context:** When to invest in self-host inference (vLLM)?

**Decision:** Stay on Anthropic + Groq + OpenRouter until bill > $10K/mo sustained 2 months. Then evaluate self-host.

**Consequences:**
- ✅ Avoid premature ops complexity
- ✅ Pay-per-use until predictable
- ❌ Margin pressure as scale grows
- ❌ Vendor risk concentration

**Status:** Accepted
**Date:** 2026-05

### ADR-018: SOC2 Type 1 at M12, not earlier

**Context:** When to start SOC2 audit? Enterprise sales requires.

**Decision:** Foundation policies M3-M6. Start Drata + audit M10-M12. Type 1 obtained M12.

**Consequences:**
- ✅ Done in time for enterprise sales push
- ✅ Cost spread over time
- ❌ Enterprise leads M6-M11 must accept "in progress" status

**Status:** Accepted
**Date:** 2026-05

### ADR-019: Use Cerbos (or OpenFGA) for authorization Stage 2+

**Context:** RBAC + ABAC needs grow as features expand. Inline `if user.role === 'admin'` becomes unmanageable.

**Decision:** Cerbos policy engine integration Stage 2 (M7-M8).

**Consequences:**
- ✅ Centralized policy
- ✅ Audit-friendly (policy as code)
- ✅ Test-friendly
- ❌ Service to operate
- ❌ Latency added (~5-10ms per check)

**Status:** Proposed
**Date:** 2026-05

### ADR-020: Adopt OpenTelemetry from M1 (not later)

**Context:** Observability instrumentation strategy.

**Decision:** OpenTelemetry SDK from Day 1 of Stage 1. Send to Sentry (traces), Better Stack (logs), Langfuse (LLM).

**Consequences:**
- ✅ Vendor-neutral standard
- ✅ Future-proof (migrate to Tempo, Honeycomb easy)
- ❌ Some setup overhead vs Sentry-direct

**Status:** Accepted
**Date:** 2026-05

---

## 21. Load Testing & Capacity Planning

### 21.1. Testing methodology

**Three types of load test:**

**Type 1: Baseline (every release)**
- 100 concurrent users, 10 min duration
- All main user flows
- Measure: P50/P95/P99 per endpoint
- Block release if regression > 10%

**Type 2: Stress (monthly)**
- Ramp 0 → 10K concurrent over 30min
- Find breaking point per service
- Identify bottleneck (CPU, memory, DB, network)
- Capacity model update

**Type 3: Soak (quarterly)**
- 1K concurrent for 24h
- Detect memory leaks, connection leaks
- Cache eviction patterns
- DB long-running query buildup

### 21.2. Tools

**Stage 1: k6 (JavaScript-based)**
- Run from GitHub Actions
- Free + open source
- Good metrics dashboard

**Stage 2: + Grafana k6 Cloud**
- $74/mo for 1K VU
- Distributed load gen
- Geographic distribution

**Stage 3: + Locust (Python) for complex scenarios**
- Stateful behavior simulation
- Custom protocols

### 21.3. Test scenarios (Cogniva)

**Scenario A: Document upload + ingest**
- 100 concurrent uploads, 10MB PDF each
- Measure: upload time, ingest pipeline lag, embed completion time
- Target: 95% complete < 60s

**Scenario B: AI chat burst**
- 500 concurrent ai-message requests
- Mix: RAG chat (60%), reasoning (20%), code (10%), summary (10%)
- Target: TTFT P95 < 2s, cost < $0.05/request

**Scenario C: Flashcard review marathon**
- 1000 concurrent users, 50 reviews each
- Measure: save latency, FSRS update time
- Target: P95 save < 200ms

**Scenario D: Live exam (Phase 17 prep)**
- 5K concurrent exam takers
- 30 questions, 60s each
- Submit answer storm
- Target: zero answer loss, leaderboard < 1s update

**Scenario E: Room collaboration**
- 100 rooms, 10 participants each = 1K concurrent
- Mix: chat messages, whiteboard updates, notes edit
- Target: msg P95 < 100ms, video RTT < 80ms

### 21.4. SLO-driven testing

**Test must verify SLO under load:**
- API P95 < 200ms at 50% capacity
- API P95 < 500ms at 80% capacity
- Error rate < 0.5% at 100% capacity
- 99% requests succeed during failover

**Bottleneck identification:**
1. Run test
2. Identify slowest path (top 5% latency)
3. Profile: CPU, DB query, network, lock contention
4. Remediation
5. Re-test
6. Document in playbook

### 21.5. Capacity model

**Per-service capacity sheet:**

| Service | Limit | Current | At 100K MAU est | Notes |
|---|---|---|---|---|
| Web app (Vercel) | 1M function-GB-s/mo | 50K | 800K | scales auto |
| Postgres conn | 1000 (Neon Pro) | 50 | 200 | pgBouncer required |
| Redis ops/sec | 100K (Upstash) | 5K | 60K | OK with cache strategy |
| AI tokens/min | per-provider limit | 1M | 50M | need rate limiter |
| LiveKit participants | 50/node Hetzner | 30 | 1000 | needs cluster |
| Soketi WS | 100K/node | 5K | 50K | 2-replica enough |
| Inngest functions | 100/sec | 10 | 500 | need scaling plan |
| Embedding RPM | 300 (Voyage paid) | 50 | 5000 | need paid + caching |

**Capacity = bottleneck × safety factor 2x**

### 21.6. Performance budget

**Per-page budget:**
- LCP: < 2.5s (Lighthouse green)
- INP: < 200ms
- CLS: < 0.1
- JS bundle: < 200KB initial (gzipped)
- Image total: < 1MB above fold
- Font: < 100KB (subset VN)
- Time to first AI token: < 2s

**Enforcement:**
- Lighthouse CI on every PR (Vercel)
- Bundle size check (next-bundle-analyzer)
- Image optimization (Cloudflare Images + next/image)
- Block merge if budget exceeded > 10%

---

## 22. Disaster Recovery Playbooks

> 15 scenarios với step-by-step runbook. Update sau mỗi incident.

### 22.1. SEV1 — Production fully down

**Scenario:** App returns 503, no users can access.

**Detection:** Better Stack alert + PagerDuty page

**Runbook:**
1. **Acknowledge** alert (< 2min)
2. **Check Vercel status**: status.vercel.com — vendor issue?
3. **Check Cloudflare**: status.cloudflare.com — DNS/edge?
4. **Check Neon**: status.neon.tech — DB?
5. **Check internal**:
   - Sentry top errors
   - Vercel deployment log
   - Last commit (revert if recent)
6. **Triage**:
   - Vendor outage → wait + status page
   - Bad deploy → rollback (`vercel rollback`)
   - DB issue → check connection count, kill long queries
   - Cert expired → renew via Let's Encrypt
7. **Communicate**: status page update every 30min
8. **Resolve**
9. **Post-mortem within 48h**

**MTTR target:** < 30 min for known issues, < 2h for novel

### 22.2. SEV1 — Database accidentally truncated

**Scenario:** Engineer ran wrong SQL, deleted table data.

**Runbook:**
1. **Acknowledge**: don't run more queries
2. **Capture**: what command ran, what time, what table
3. **Stop writes**: feature flag or maintenance mode
4. **PITR restore** Neon to before the bad command:
   ```
   neonctl branches create --parent-id <prod> --timestamp "2026-05-11T10:30:00Z" --name "restore-attempt"
   ```
5. **Verify**: query restored branch, check data integrity
6. **Copy data back**: 
   ```sql
   INSERT INTO production.flashcard 
   SELECT * FROM restored.flashcard 
   WHERE id NOT IN (SELECT id FROM production.flashcard);
   ```
7. **Resume writes**: remove maintenance mode
8. **Audit**: lock down DDL access, require 2-person approval for prod queries

**RTO:** < 1h. **RPO:** < 5min.

### 22.3. SEV1 — Region complete failure

**Scenario:** AWS US-East-1 (or Vercel APAC) total outage.

**Runbook:**
1. **Identify** affected region
2. **DNS failover**: Cloudflare Workers route traffic to other region
3. **DB promote replica**: if primary region down, promote read replica to primary
4. **App restart**: clear cache, restart workers (some may have cached bad region)
5. **Verify**: synthetic tests from non-affected regions
6. **Monitor**: watch DB lag (now writes go to old replica)
7. **Customer comm**: status page + targeted email if account-affecting

**RTO:** < 30 min. **RPO:** < 5min (depends on replication lag).

### 22.4. SEV1 — Security breach (data leak)

**Scenario:** Unauthorized access detected, potential PII exposure.

**Runbook:**
1. **Acknowledge** + alert security team + legal + CEO
2. **Contain**: 
   - Revoke compromised credentials
   - Block attacker IP at Cloudflare
   - Disable affected user account if account takeover
3. **Investigate**:
   - Sentry security events
   - Audit log access
   - Cloudflare logs
   - DB query log
4. **Forensics**: what was accessed, what was exfiltrated
5. **Notification** (GDPR 72h):
   - Affected users (clear language)
   - Regulators (DPO contact list)
   - Public statement if mass
6. **Remediation**:
   - Rotate secrets
   - Patch vulnerability
   - Update WAF rules
7. **Post-mortem**: blameless, share learnings

### 22.5. SEV2 — LLM provider down

**Scenario:** Anthropic API returns 503 for > 5 min.

**Runbook:**
1. **Auto**: circuit breaker switches to fallback (GPT-5)
2. **Verify**: fallback working (Sentry no error spike)
3. **Communicate**: status page note "AI degraded"
4. **Monitor** Anthropic status page
5. **Resume**: when primary back, circuit breaker auto-restores
6. **Cost check**: fallback may be more expensive — verify within budget

### 22.6. SEV2 — Database connection pool exhausted

**Scenario:** Postgres reports too many connections, app errors 503.

**Runbook:**
1. **Identify** which app is leaking
2. **Restart** affected service (clears stuck connections)
3. **pgBouncer** check: is pooling working?
4. **Long queries**: kill blockers (`SELECT pg_cancel_backend(pid)`)
5. **Connection limits**: lower per-app max
6. **Investigate code**: connection not released (await missing, etc.)

### 22.7. SEV2 — Inngest queue backlog

**Scenario:** Inngest function queue > 10K pending, causing user delay.

**Runbook:**
1. **Identify** which function slowest
2. **Scale concurrency**: increase Inngest concurrency limit
3. **Triage**: which jobs are critical vs deferrable
4. **Drain**: process critical first
5. **Code fix**: optimize slow function

### 22.8. SEV2 — AI cost spike

**Scenario:** Hourly AI cost > $500 (alarm trigger).

**Runbook:**
1. **Identify**: which user / endpoint causing
2. **Investigate**: bug or attack?
3. **Mitigate**:
   - Temp quota reduce
   - Block bad user
   - Disable expensive feature
4. **Refund**: if user-impacting block
5. **Code fix**: prompt template bug, infinite loop

### 22.9. SEV2 — Storage R2 high error rate

**Scenario:** R2 returning 5xx for > 5% requests.

**Runbook:**
1. **Cloudflare status check**
2. **Retry**: app should retry on 5xx
3. **Cache**: serve cached results if possible
4. **Backup bucket**: switch to secondary if persistent
5. **Customer comm**: if upload affected

### 22.10. SEV3 — Email delivery degraded

**Scenario:** Postmark bounce rate spike.

**Runbook:**
1. **Check**: SPF/DKIM/DMARC valid
2. **Sender reputation**: Google Postmaster Tools
3. **Switch**: use backup sender (SendGrid)
4. **List hygiene**: remove hard bounces

### 22.11. Maintenance mode procedure

**When:** Planned migration that needs downtime.

**Procedure:**
1. **Announce**: 1 week advance email
2. **Status page**: update + subscribe option
3. **At T-1h**: lower TTL on DNS
4. **At T-15min**: status page "Maintenance starting in 15min"
5. **At T-0**:
   - Feature flag `ops.maintenance` = true
   - All requests → 503 with maintenance page
   - DB write proxy disabled
6. **Do migration**
7. **Validate**: smoke test from external
8. **Resume**: flag = false
9. **Status page**: "Maintenance complete"
10. **Post-mortem** if anything unexpected

### 22.12. Backup restore drill

**Frequency:** Monthly

**Procedure:**
1. Pick a yesterday timestamp
2. Create Neon branch from that PITR
3. Verify: count of rows in critical tables
4. Run app against branch (read-only)
5. Verify: smoke tests pass
6. Delete branch
7. Document: time taken, issues found

### 22.13. Account takeover playbook

**Detection:** Suspicious login (new geo, new device, multiple fails).

**Procedure:**
1. **Auto-flag**: require 2FA verify
2. **If failed**: lock account
3. **Notify user**: email + SMS "suspicious activity"
4. **Allow recovery**: identity verification (KYC level)
5. **Audit**: what was accessed during suspicious session
6. **Restore**: with new password

### 22.14. DDoS attack

**Detection:** Cloudflare reports DDoS active.

**Procedure:**
1. **Cloudflare auto** mitigation usually sufficient
2. **Escalate** to Cloudflare DDoS team if persistent
3. **Rate limit** stricter (per-IP, per-route)
4. **Bot mode** (Cloudflare): "I'm Under Attack"
5. **Origin shielding**: only Cloudflare IPs allowed
6. **Investigate**: source patterns, targeted feature
7. **Post-incident**: lessons + better baseline rate limits

### 22.15. Vendor lock-in emergency exit

**Scenario:** Need to leave Vercel/Anthropic in emergency.

**Vercel exit:**
- Have Fly.io deployment ready as alt
- DNS switch (TTL 60s)
- Verify Node runtime compat
- 2-4 hour migration realistic

**Anthropic exit:**
- Multi-provider router pre-configured
- Flip primary in config
- Eval drop expected ~5-10% on swap
- Acceptable for emergency

---

## 23. Anti-patterns & Cargo-cult Avoidance

> Things to NOT do. Learned the hard way (or from others'). Updated each retro.

### 23.1. Premature optimization

❌ **Don't** rewrite Node.js → Go before measuring bottleneck
❌ **Don't** add Kubernetes before > 30 services
❌ **Don't** add service mesh before > 15 services
❌ **Don't** add GraphQL before > 10 client apps
❌ **Don't** migrate Qdrant before pgvector measured slow
❌ **Don't** add Kafka before async needs justify

**Rule:** Add complexity only when current solution measured insufficient.

### 23.2. Premature distribution

❌ **Don't** extract services because "microservices is best practice"
❌ **Don't** decompose by team Conway-law before team grows past 1-2 pizza
❌ **Don't** split database before measured contention
❌ **Don't** go multi-region before user base demands

**Rule:** Distribution = ops complexity 5x. Earn it.

### 23.3. Cargo-cult tools

❌ **Don't** adopt Rust because "Rust is fast" — only if Node bottleneck proven
❌ **Don't** use Kubernetes because "everyone does" — Fly.io / Nomad easier
❌ **Don't** use Kafka because "industry standard" — Inngest / SQS often enough
❌ **Don't** use NoSQL because "scale" — Postgres scales further than thought

**Rule:** Pick tool because it solves YOUR problem, not because BigCo uses.

### 23.4. Premature abstractions

❌ **Don't** build "framework" before having 3 use cases
❌ **Don't** add config layer for 1-time decision
❌ **Don't** wrap library "just in case"
❌ **Don't** add interface for single implementation

**Rule:** Wait for 3rd duplication before extracting. Boilerplate < wrong abstraction.

### 23.5. Tech debt patterns

❌ **Don't** disable type checks "temporarily" without ticket
❌ **Don't** comment out tests instead of fixing
❌ **Don't** swallow errors with empty catch
❌ **Don't** add `any` without reason in comment
❌ **Don't** create one-off scripts in `tmp/` (commit or delete)

**Rule:** Tech debt is OK if **documented + tracked**. Hidden debt is the problem.

### 23.6. Security anti-patterns

❌ **Don't** store secrets in code (even private repo)
❌ **Don't** disable HTTPS in production "just for debug"
❌ **Don't** trust user input (even from authenticated users)
❌ **Don't** roll your own crypto
❌ **Don't** use MD5/SHA1 for security
❌ **Don't** use predictable IDs (use UUID/cuid)

### 23.7. Database anti-patterns

❌ **Don't** add indexes "to be safe" — measure first
❌ **Don't** use SELECT * in app code
❌ **Don't** N+1 query (use joins or batches)
❌ **Don't** ORM lazy load in loops
❌ **Don't** large UPDATEs without batching
❌ **Don't** schema migration with table lock during business hours

### 23.8. AI anti-patterns

❌ **Don't** ship LLM change without eval pass
❌ **Don't** trust LLM output without validation (JSON parse, citation check)
❌ **Don't** put user input directly in prompt (sanitize)
❌ **Don't** pay per-token without cost guardrails
❌ **Don't** prompt-engineer in production without versioning
❌ **Don't** use AI detection as sole evidence (high false positive)

### 23.9. UX anti-patterns

❌ **Don't** show generic "Error" messages — be specific
❌ **Don't** auto-play video/audio
❌ **Don't** block UI with sync API call (use loading state)
❌ **Don't** confirm-dialog every action (annoying)
❌ **Don't** notification spam (cap 5/day)
❌ **Don't** trap focus (allow Esc to close modals)

### 23.10. Process anti-patterns

❌ **Don't** standup as status report (use written async)
❌ **Don't** retro without action items
❌ **Don't** post-mortem with blame
❌ **Don't** PR review without context (commit message + PR description)
❌ **Don't** merge "fix later" without ticket

### 23.11. Hiring anti-patterns

❌ **Don't** hire for hot tech ("we use Rust!" only)
❌ **Don't** ignore culture fit for skills
❌ **Don't** rush hire to "fill seat" — bad hire 2x cost of vacant
❌ **Don't** assess only with whiteboard (use take-home + paired code)
❌ **Don't** skip reference check

### 23.12. Vendor anti-patterns

❌ **Don't** sign multi-year commitment for unproven need
❌ **Don't** trust vendor uptime claims — verify status page history
❌ **Don't** skip exit plan ("how do we leave?")
❌ **Don't** miss the "spec compliance" footnotes (Pusher protocol etc.)
❌ **Don't** rely on single vendor for critical path (always alt)

### 23.13. Cogniva-specific anti-patterns

❌ **Don't** ship AI feature without VN eval (Western model often poor VN)
❌ **Don't** assume all students have stable internet (offline must work)
❌ **Don't** require email for under-13 signup (COPPA)
❌ **Don't** auto-grade without rubric documented (academic integrity)
❌ **Don't** copy textbook content without license (copyright)
❌ **Don't** ignore VN MOET curriculum if selling to schools

---

## 24. Definition of Done

### 24.1. Sau Stage 1 (M3) — Foundation done

- ✅ Multi-instance safe (Redis rate limit, JWT session)
- ✅ Observability complete (Sentry + Langfuse + logs + dashboards)
- ✅ Cost guardrails (per-user quota + circuit breaker)
- ✅ DR drill successful 2x
- ✅ GDPR compliance baseline (DSR endpoints, audit log)
- ✅ Feature flag system in production
- ✅ Load test baseline (1K concurrent pass)
- ✅ Hired: 1 DevOps + 1 senior eng

### 24.2. Sau Stage 2 (M12) — Distributed Monolith done

**Performance:**
- ✅ P95 API < 250ms regional
- ✅ P95 API < 500ms global (cross-region)
- ✅ AI TTFT P95 (Sonnet) < 1.5s
- ✅ Mobile DAU > 30% total DAU
- ✅ Page LCP < 1.2s warm

**Reliability:**
- ✅ 99.9% uptime sustained 6 months
- ✅ RTO < 1h, RPO < 5min
- ✅ Successful region failover drill
- ✅ Zero data loss any incident

**Scale:**
- ✅ 100K MAU sustained
- ✅ 5K concurrent peak handled
- ✅ Mobile + web feature parity (90%+)

**Compliance:**
- ✅ SOC2 Type 1 certified
- ✅ GDPR + FERPA + COPPA compliant
- ✅ Penetration test passed
- ✅ Bug bounty program live

**Team:**
- ✅ Team 15 engineers
- ✅ On-call rotation 5-8 engineers
- ✅ Documentation up-to-date
- ✅ ADRs maintained

**Cost:**
- ✅ < $1.20/user/month infra
- ✅ Gross margin > 80%
- ✅ Per-feature cost dashboards
- ✅ AI cost < 50% total infra

### 24.3. Sau Stage 3 (M18) — Big Tech ready

**Performance:**
- ✅ P95 API < 150ms regional, < 300ms global
- ✅ AI TTFT P95 < 900ms (Sonnet), < 350ms (Haiku/Groq)
- ✅ Video RTT < 60ms intra-region for 95% sessions

**Reliability:**
- ✅ 99.95% uptime sustained 12 months
- ✅ Active-active multi-region (no failover needed)
- ✅ Chaos engineering automated quarterly drills

**Scale:**
- ✅ 600K MAU sustained
- ✅ Tested for 10x traffic spike
- ✅ Per-service horizontal scale automated

**Security:**
- ✅ SOC2 Type 2 certified
- ✅ HIPAA-ready
- ✅ Zero critical CVEs in dependencies
- ✅ Quarterly external pentest passed

**Cost:**
- ✅ < $0.80/user/month infra
- ✅ Gross margin > 90%
- ✅ Self-host inference for cost ceiling
- ✅ Cost forecasting accurate ±10%

**Operations:**
- ✅ < 1 SEV1 incident/quarter
- ✅ MTTR < 30 minutes
- ✅ Post-mortems blameless, action-items tracked
- ✅ Documentation auto-generated where possible

**Team:**
- ✅ Team 35-50 engineers
- ✅ Dedicated SRE team
- ✅ Security team (2-3 FTE)
- ✅ T&S team (2-3 FTE)
- ✅ Engineering culture: trunk-based, paired, on-call healthy

### 24.4. Definition of NOT done (anti-criteria)

**Things that don't count as done:**
- ❌ "Built but not load-tested" — load test required
- ❌ "Tested in staging but not prod" — feature flag canary required
- ❌ "Works for me locally" — at least 1 reviewer must verify
- ❌ "Tests pass but no e2e" — critical paths need e2e
- ❌ "Deployed but no monitoring" — alerts required before "done"
- ❌ "Live but no docs" — runbook + ADR required

---

## 📚 Appendix A — Reference architectures

### A.1. Big tech we can learn from

| Company | What they got right | Source |
|---|---|---|
| **Notion** | Block-based architecture, edge cache aggressive | Notion eng blog |
| **Linear** | Sync engine offline-first, optimistic UI | Linear blog |
| **Discord** | Cassandra → ScyllaDB, Elixir for WS | Discord eng blog |
| **Slack** | Job queue Kafka, search Solr | Slack eng blog |
| **Shopify** | Pod isolation, multi-tenant | Shopify eng blog |
| **Stripe** | Idempotency, API versioning | Stripe blog |
| **Cloudflare** | Workers + Durable Objects | Cloudflare blog |
| **Vercel** | Edge functions, ISR | Vercel blog |
| **Anthropic** | Claude API, prompt caching | Anthropic docs |
| **Khan Academy** | Mastery-based progression UX | Khan Academy blog |

### A.2. Ed-tech specific references

- **Duolingo**: gamification + spaced repetition at scale
- **Khan Academy**: mastery-based progression, free tier sustainable
- **Coursera/edX**: video CDN, transcript search
- **Quizlet**: flashcard scale, monetization
- **Brilliant**: interactive problem-solving, premium model
- **Memrise**: spaced repetition with native speaker audio

### A.3. Open source we lean on

- Next.js (Vercel)
- Drizzle ORM
- TipTap (collaborative editor)
- Excalidraw (whiteboard)
- LiveKit (WebRTC SFU)
- Soketi (Pusher-compatible)
- Hocuspocus (Yjs server)
- shadcn/ui (component library)
- Better Auth

**Give back:** PR fixes upstream when possible. Sponsor critical deps.

---

## 📚 Appendix B — References

### B.1. Books (must-read at scale)

- "Designing Data-Intensive Applications" — Kleppmann (Postgres, Kafka, CRDT)
- "Site Reliability Engineering" — Google (SRE practices)
- "The Phoenix Project" — Kim (DevOps fiction)
- "Accelerate" — Forsgren (high-performing eng metrics)
- "Building Microservices" — Newman (when to + how to)
- "Database Reliability Engineering" — Campbell (DB ops)
- "Release It!" — Nygard (resilience patterns)
- "The Manager's Path" — Fournier (engineering management)

### B.2. Papers

- "Out of the Tar Pit" — Moseley & Marks (simplicity)
- "Time, Clocks, and the Ordering of Events" — Lamport
- "The Byzantine Generals Problem" — Lamport
- "Dynamo: Amazon's Highly Available Key-value Store" — DeCandia et al.
- "Bigtable: A Distributed Storage System for Structured Data" — Chang et al.
- "Spanner: Google's Globally-Distributed Database" — Corbett et al.
- "FSRS Algorithm Paper" — Ye et al. (spaced repetition)
- "Retrieval-Augmented Generation" — Lewis et al. (RAG)

### B.3. Talks

- "Crockford on JavaScript" — Douglas Crockford
- "Hammock Driven Development" — Rich Hickey
- "Simple Made Easy" — Rich Hickey
- "The Cost of Decisions" — Will Larson
- "Run Less Software" — Rich Archbold (Intercom)
- "Three Stories Of Service Mesh" — William Morgan (Linkerd)

### B.4. Blogs to follow

- High Scalability — architecture case studies
- Increment — devops + SRE
- LWN.net — kernel/OS deep dives
- Postgres Weekly — DB updates
- TLDR Newsletter — daily tech news
- Hacker News — community
- Engineering blogs: Stripe, Notion, Linear, Discord, Cloudflare

### B.5. Podcasts

- Software Engineering Daily
- The Pragmatic Engineer
- Changelog
- Lex Fridman (AI)
- Acquired (business + tech case studies)

---

## 📚 Appendix C — Vendor evaluation rubric

### C.1. Vendor scoring (1-5 each)

| Dimension | Weight | Question |
|---|---|---|
| Fit | 25% | Does it solve our problem now? |
| Cost | 20% | TCO including ops at our scale? |
| Lock-in | 15% | Can we exit in < 1 month if needed? |
| Reliability | 15% | Track record SLA, incident history? |
| Security | 10% | SOC2, GDPR-compliant, encryption? |
| Support | 5% | Response time, channel options? |
| Community | 5% | Documentation, Stack Overflow, GitHub stars? |
| Roadmap | 5% | Do they prioritize features we need? |

**Total Score = Sum(Score × Weight)**

**Decision:**
- Score > 4.0: adopt
- Score 3.0-4.0: trial 30 days
- Score < 3.0: reject

### C.2. Standard questions for vendor sales

1. What is your SLA? Show incident history.
2. What is the cost at 10x our current scale?
3. How do we export our data? Format?
4. Who else at our size uses you? References?
5. What is your security posture? SOC2 / ISO / GDPR?
6. How do we contact you when production is down?
7. What is the upgrade path between tiers?
8. What is the deprecation policy for features?

### C.3. Red flags in vendor

- ❌ Cannot articulate exit plan
- ❌ No status page or public uptime metrics
- ❌ "We're working on" for compliance certs
- ❌ Per-seat pricing for non-seat users (anti-pattern)
- ❌ Long-term contract lock-in (> 1 year)
- ❌ Vague pricing ("contact sales" for basic plan)
- ❌ Cannot show similar-scale customer references
- ❌ No support response within 4h business

---

## 📚 Appendix D — Engineering culture playbook

### D.1. Operating principles

1. **Customer first, always**: every decision asks "does this make customer better?"
2. **Bias toward action**: ship + iterate > perfect plan
3. **Disagree + commit**: argue position, then execute team decision
4. **Hire smart people, get out of way**: trust, low bureaucracy
5. **Document or it didn't happen**: written async > verbal
6. **Build for next eng**: code others can maintain
7. **Measure to improve**: data > opinion (when data exists)
8. **Ownership > assignment**: owners drive, not just executors

### D.2. Communication norms

- **Default async**: Slack, GitHub, docs. Meetings only when essential.
- **Async meeting culture**: agenda + pre-read + decisions doc
- **No "got a minute"** without context — give async first
- **PR description = mini design doc**
- **Comment hard decisions in code** (why, not what)
- **Status updates weekly**: brief, async, in writing

### D.3. Meeting types

| Meeting | Frequency | Duration | Purpose |
|---|---|---|---|
| Engineering all-hands | Bi-weekly | 60min | Updates, demos |
| Team standup | Daily | 15min async | Blocker only |
| Retro | Bi-weekly | 90min | Process improvement |
| Architecture review | Weekly | 60min | Design discussions |
| Incident post-mortem | Within 48h SEV1/2 | 60min | Learn from outage |
| 1-on-1 | Weekly | 30min | Personal + career |
| Sprint planning | Bi-weekly | 60min | Prioritize next 2 weeks |

### D.4. Career growth

**Engineering levels:**
- L1: Junior (0-2y)
- L2: Mid (2-5y)
- L3: Senior (5-8y)
- L4: Staff (8-12y)
- L5: Principal (12y+)
- L6: Distinguished (rare)

**Promotion criteria (each level):**
- Scope: individual → team → multi-team → org-wide
- Impact: tickets → projects → initiatives → strategy
- Leadership: self → mentor → lead → influence

**Career ladder doc** (transparent):
- Salary band per level
- Expectations per level
- Examples of behavior

### D.5. Hiring process

**Steps:**
1. Application review (24h)
2. Phone screen (30min)
3. Take-home coding challenge (3-5h, paid above mid-level)
4. Technical interview (2x 60min)
5. System design (60min, for senior+)
6. Behavioral / culture (45min)
7. References (2 minimum)
8. Offer (within 48h decision)

**Total time:** 2-3 weeks ideal

**Interview rubric (written):**
- Technical depth (1-5)
- Communication (1-5)
- Problem-solving (1-5)
- Culture fit (1-5)

**Calibration:**
- Interviewers train together
- Score independently, discuss after
- Hire/no-hire decision: unanimous strong yes

### D.6. Onboarding (first 90 days)

**Week 1:**
- Setup laptop + accounts
- Read architecture overview
- Pair with buddy
- Ship one trivial PR (build confidence)

**Week 2-4:**
- Ship one small bug fix
- Pair with each team member
- Shadow on-call

**Month 2:**
- Take small feature ownership
- Be on-call (with buddy)
- Present "what I learned" to team

**Month 3:**
- Own a meaningful feature
- Solo on-call
- 30-60-90 review with manager

### D.7. Engineering values

- **Quality > speed**: ship right > ship fast
- **Boring > novel**: use proven tech for production
- **Simple > clever**: future maintainer thanks you
- **Iterate > plan**: small steps + feedback
- **Diverse perspectives**: hire for difference
- **Sustainable pace**: no hero hours, marathon not sprint

---

## 📌 Tóm tắt thực tế (so với v1)

### Khác biệt chính v1 → v2

| Aspect | v1 | v2 |
|---|---|---|
| Timeline | 12 tháng | 18 tháng |
| Stage structure | Linear | 3 explicit stage với exit criteria |
| Performance targets | Aspirational (100ms global, 99.99%) | Grounded (200ms regional, 99.95%) |
| Tech choices | Buzzword-driven (CockroachDB, K8s, mesh sớm) | Problem-driven (Postgres lâu, evolve) |
| Wrong factual claims | "Soketi 10K", "TTFT 400ms Claude" | Corrected with sources |
| Missing layers | No Mobile, Growth, CustOps, Education-specific | 4 new layers added |
| Risk management | None | 30-risk register tracked |
| ADRs | None | 20 ADRs documented |
| DR | High-level mention | 15 runbooks step-by-step |
| Anti-patterns | None | 13 categories documented |
| Cogniva-specific | None | Dedicated section §3 |
| Compliance | SOC2 + GDPR mention | Full FERPA + COPPA + VN MOET roadmap |

### Cho hiện tại Cogniva (1-2 eng, pre-PMF)

**Đọc + làm theo §15.1 (Stage 1, M1-M3) ONLY.**

8-12 tuần work cụ thể:
1. Rate limiter Redis (W1)
2. JWT session (W2)
3. Read replica + pgBouncer (W3)
4. Observability stack (W4)
5. Cost guardrails + AI quota (W5-6)
6. DR drill + Backup test (W7)
7. Load test baseline (W8)
8. GDPR compliance baseline (W9-10)
9. Hiring DevOps (M3)

Tất cả phần còn lại của tài liệu = vision, reference khi gặp scaling problem, talking point investor.

### Cho VC / investor

**Trình bày §0 + §1.1 + §15 + §17.**

Show:
- Vision clearly articulated
- Math grounded (no fake numbers)
- Phased execution with exit criteria
- Team plan realistic
- Revenue model + margins computed

### Cho CTO / senior eng đang join

**Đọc hết. Đặc biệt:**
- §2 (Architecture Evolution) — understand the phases
- §3 (Cogniva-specific) — ed-tech challenges unique
- §19 (Risk register) — what keeps founder up at night
- §20 (ADRs) — decisions already made
- §23 (Anti-patterns) — what NOT to do

### Khi nào revisit plan này

- **Monthly:** §19 risk register, §17 cost
- **Quarterly:** §15 roadmap progress, §16 hiring plan
- **Per-stage exit:** §24 DoD checklist
- **Yearly:** entire document review + version bump

---

*Cogniva Scale-Up Master Plan **v2.0** — 18-month roadmap from MVP to 600K MAU big-tech-grade platform.*  
*Last updated: 2026-05-11*  
*Authors: Cogniva team + AI architect review*  
*Status: Living document. Update each retro + ADR addition.*

