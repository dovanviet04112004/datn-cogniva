# prisma/NOTES.md — những thứ SỐNG NGOÀI schema.prisma

> ⚠️ ĐỌC TRƯỚC KHI chạy `prisma migrate dev`. Các object dưới đây tồn tại trong
> DB (Neon + docker local) nhưng Prisma không biểu diễn được trong schema —
> nếu migration sinh ra có lệnh DROP chúng thì **phải sửa tay file SQL trước
> khi apply**, không là vỡ search/quiz.

## Nguồn gốc schema

- `schema.prisma` sinh bằng `prisma db pull` từ **Neon** 2026-06-10
  (103 model · 21 enum · 1.842 dòng). Tên model/field giữ snake_case như DB;
  rename + `@map` làm DẦN theo wave (chỉ đổi model mà wave đó đụng).
- Lịch sử migration Drizzle cũ: `packages/db/migrations/0000–0057` (đóng băng).

## Quy trình migration (apply CẢ HAI DB)

```bash
cd apps/api
pnpm exec prisma migrate dev --name <ten>     # DATABASE_URL/DIRECT_DATABASE_URL = Neon
# rồi apply CÙNG file SQL vào docker local:
#   pnpm exec prisma migrate deploy  (với DATABASE_URL=DATABASE_URL_LOCAL)
```

Local docker: `postgresql://postgres:postgres@localhost:5432/cogniva`
(`pnpm db:up` ở root để bật container).

## Objects KHÔNG nằm trong schema.prisma

### 1. Expression index (Prisma báo skip khi db pull)

- `chunk_content_tsv_idx` — GIN `to_tsvector('english', content)` trên `chunk`.
- `library_course_uniq` — unique theo expression trên `library_course`.

### 2. Index HNSW (pgvector) — db pull không thấy operator class

- `chunk.embedding`, `concept.embedding`, `library_doc_chunk.content_vec`,
  `library_doc_atom.embedding`, `tutor_profile.bio_embedding`,
  `tutor_request.embedding` — đều có index `USING hnsw (… vector_cosine_ops)`.
- Cột để dạng `Unsupported("vector")?` — query qua `$queryRaw`
  (`embedding <=> $1::vector`). GĐ2 chuyển Qdrant sẽ drop cả cột lẫn index.

### 3. Partial unique index

- `quiz_response_user_question_quick_idx` trên `quiz_response(user_id,
question_id) WHERE attempt_id IS NULL` — Prisma không hỗ trợ partial index
  → không xuất hiện trong schema, nhưng PHẢI tồn tại trong DB (chống double
  marker quick-quiz).

### 4. CHECK constraints

- ~30 check constraint (db pull liệt kê khi chạy) — sống trong DB, Prisma bỏ
  qua. Đừng tái tạo logic này ở app layer rồi xoá constraint.

### 5. Generated columns tsvector

- Các cột `search_vec Unsupported("tsvector") @default(dbgenerated(…))` là
  GENERATED column — không bao giờ insert/update trực tiếp.

## Runtime

- `DATABASE_URL` (pooled, `?pgbouncer=true`) cho PrismaClient;
  `DIRECT_DATABASE_URL` (unpooled) cho migrate/introspect.
- Advisory lock giữ nguyên pattern:
  `tx.$executeRaw\`SELECT pg_advisory_xact_lock(hashtext(${key}))\``.
