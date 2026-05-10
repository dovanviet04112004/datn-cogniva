# Cogniva

> AI-native learning platform with personal knowledge graph, multi-stage RAG, and adaptive mastery tracking.

This repository follows the master plan in [`plan.md`](./plan.md). You are reading the **Phase 0 — Foundation** build.

---

## Stack

| Layer        | Choice                                                |
| ------------ | ----------------------------------------------------- |
| Frontend     | Next.js 15 (App Router) + React 19 + TypeScript       |
| UI           | Tailwind CSS 3 + shadcn/ui (New York) + Lucide icons  |
| State        | Zustand (client) · server components by default       |
| Forms        | React Hook Form + Zod                                 |
| Auth         | **Better Auth** (email/password + optional Google)    |
| Database     | **Drizzle ORM** + PostgreSQL 16 + pgvector            |
| AI           | **Mastra** (planned, Phase 2) + Claude + OpenAI       |
| Tooling      | pnpm workspaces + Turborepo + Vitest + Playwright     |
| Hosting      | Vercel (web) · self-hosted Postgres or Neon (db)      |

See [`plan.md`](./plan.md) §3 for the full rationale, including why Drizzle over Prisma, Mastra over LangGraph, and Better Auth over Clerk.

---

## Repo layout

```
cogniva/
├── apps/
│   └── web/                 — Next.js app (UI + API routes + auth handler)
├── packages/
│   └── db/                  — Drizzle schema + client (postgres.js)
├── tooling/
│   └── tsconfig/            — shared tsconfig presets
├── infrastructure/
│   └── docker/postgres/     — pgvector init.sql
├── docker-compose.yml       — local Postgres 16 + pgvector
├── turbo.json               — Turborepo task graph
├── pnpm-workspace.yaml
└── plan.md                  — master plan (16-week roadmap)
```

---

## Prerequisites

- Node.js 20+ (22 recommended) — `node --version`
- pnpm 9+ — `pnpm --version`
- Docker Desktop — for local Postgres + pgvector
- Git

---

## Quick start

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env file and fill secrets
cp apps/web/.env.example apps/web/.env.local

#    At minimum set:
#    - BETTER_AUTH_SECRET   (generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
#    - DATABASE_URL         (the docker compose default works as-is)

# 3. Start local Postgres + pgvector
pnpm db:up

# 4. Generate + apply the initial migration
pnpm db:generate                       # writes packages/db/migrations/*.sql
pnpm --filter=@cogniva/db db:migrate   # applies them to Postgres

# 5. Run the dev server
pnpm dev
```

Open http://localhost:3000.

- `/`              — marketing landing
- `/sign-up`       — create an account
- `/sign-in`       — sign in
- `/dashboard`     — authenticated home (protected by middleware)

> ⚠️ On Windows, prefer `db:generate` + `db:migrate` over `db:push`. The
> `drizzle-kit push` confirmation prompt requires a real TTY (arrow-key
> picker) and hangs in non-interactive shells. See *Troubleshooting* below.

---

## Daily workflow

Once everything is installed once, a typical session is:

```bash
pnpm db:up        # start Postgres in background (idempotent)
pnpm dev          # start Next.js + watch every package via Turbo
# … work, save, hot reload …
# Ctrl+C the dev server when done
pnpm db:down      # optional — stop Postgres if you want to free RAM
```

When you change `packages/db/src/schema.ts`:

```bash
pnpm db:generate                       # generate a new SQL migration
pnpm --filter=@cogniva/db db:migrate   # apply it
```

---

## Common scripts

### App-level

| Command              | Action                                                          |
| -------------------- | --------------------------------------------------------------- |
| `pnpm dev`           | Run all dev servers via Turborepo                               |
| `pnpm build`         | Build every package                                             |
| `pnpm typecheck`     | TypeScript check across the monorepo                            |
| `pnpm lint`          | ESLint                                                          |
| `pnpm format`        | Prettier write                                                  |
| `pnpm format:check`  | Prettier check (used in CI)                                     |

### Database (local Postgres via Docker)

| Command                                | Action                                                              |
| -------------------------------------- | ------------------------------------------------------------------- |
| `pnpm db:up`                           | Start Postgres + pgvector container in the background               |
| `pnpm db:down`                         | Stop the Postgres container                                         |
| `pnpm db:logs`                         | Tail Postgres logs (`Ctrl+C` to exit)                               |
| `pnpm db:generate`                     | Generate a new SQL migration from the current Drizzle schema        |
| `pnpm --filter=@cogniva/db db:migrate` | Apply pending migrations to the configured `DATABASE_URL`           |
| `pnpm --filter=@cogniva/db db:studio`  | Open Drizzle Studio (web UI to browse/edit DB rows)                 |
| `pnpm db:push`                         | Push schema directly without a migration file (⚠️ Linux/macOS only) |

---

## Reset the database

Useful when an early-stage migration goes sideways and you want a clean slate:

```bash
pnpm db:down
docker volume rm cogniva-postgres-data   # nukes all data
pnpm db:up
pnpm --filter=@cogniva/db db:migrate
```

---

## Troubleshooting

**`pnpm db:push` hangs forever (Windows).**
The `drizzle-kit push` confirmation prompt is an arrow-key picker that needs
a real TTY. PowerShell tool calls and CI shells aren't TTY → it appears to
hang and eventually aborts. Use `db:generate` + `db:migrate` instead.

**`column cannot have more than 2000 dimensions for hnsw index`.**
pgvector's HNSW index supports at most 2000 dimensions. Our schema uses
`vector(1536)` to stay within that limit — you can call OpenAI's
`text-embedding-3-large` with `dimensions: 1536` (Matryoshka truncation,
~1% accuracy loss) or use `text-embedding-3-small` natively. To support
the full 3072 later, switch the column to `halfvec(3072)` (HNSW supports
up to 4000 dim) or to `vector(3072)` with an `IVFFlat` index. See
[`plan.md`](./plan.md) §5.2.

**Better Auth warns about a low-entropy `BETTER_AUTH_SECRET`.**
Regenerate one with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
and paste it into `apps/web/.env.local`. The default placeholder only
exists so the dev server doesn't crash on first boot.

**`DATABASE_URL is not set` from `@cogniva/db` at module load.**
Either `apps/web/.env.local` is missing the variable, or you're running a
script that doesn't load it. The package uses a lazy proxy so the error
only fires on the first DB call — make sure your env file is loaded before
the request reaches `db.select(...)`.

**Port 5432 already in use.**
You probably already have a local Postgres. Either stop it
(`net stop postgresql-x64-XX` on Windows, `brew services stop postgresql`
on macOS) or change the host port mapping in `docker-compose.yml` to e.g.
`"5433:5432"` and update `DATABASE_URL` accordingly.

---

## Deploying to Vercel

1. Push the repo to GitHub.
2. Import the project in Vercel and set the **root directory** to `apps/web`.
3. Configure the build settings (Vercel auto-detects Next.js + Turborepo):
   - Build command: `cd ../.. && pnpm turbo run build --filter=@cogniva/web`
   - Install command: `pnpm install --frozen-lockfile`
4. Add environment variables (mirror `.env.example`). The required ones for a minimal deploy are:
   - `DATABASE_URL`
   - `BETTER_AUTH_SECRET`
   - `BETTER_AUTH_URL` (your Vercel URL)
   - `NEXT_PUBLIC_APP_URL`
5. Provision a managed Postgres with pgvector — [Neon](https://neon.tech), [Supabase](https://supabase.com), or [Railway](https://railway.app) all work.

---

## Roadmap

This is **Phase 0**. Phases 1–11 are scoped in [`plan.md`](./plan.md) §10. The next phase (Document Ingestion) lands the upload flow, R2 storage, ingestion worker, and PDF viewer.
