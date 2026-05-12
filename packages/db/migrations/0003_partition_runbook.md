# Partition Runbook — room_message + review

> **Mục tiêu:** Partition 2 bảng append-heavy theo `month` để query gần và
> archive/delete cũ rẻ. Plan v2 §15.1 W3-4 / §5.1.1.
>
> **Trạng thái:** Chưa apply. Chạy khi 1 trong 2 điều kiện:
> 1. Bảng > 50M row (currently neither)
> 2. Query P95 > 200ms với index hợp lệ
>
> **KHÔNG auto-apply qua drizzle-kit.** Partition migration là breaking change
> cần downtime ngắn (rename swap) hoặc shadow-table dual-write 2-4 tuần. Cần
> kế hoạch riêng cho production.

---

## 1. Vì sao partition?

**Append-only tables** (`room_message`, `review`, `room_event`, `audit_log`) phát triển tuyến tính theo thời gian. Khi > 50M row:

- **Query latency tăng**: index B-tree height tăng → lookup chậm dần.
- **Vacuum chậm**: 1 lần vacuum quét toàn table dù chỉ 0.1% data thay đổi.
- **Backup dump lớn**: pg_dump cả table dù chỉ cần dữ liệu mới.
- **Archive khó**: muốn xoá row > 1 năm tuổi = `DELETE` chậm + bloat WAL.

**Partition by month** giải quyết hết:
- Partition pruning: query với WHERE created_at > X chỉ scan partition liên quan.
- Vacuum partition độc lập (mới đổi, cũ stable).
- DROP PARTITION cho archive — instant, không bloat.
- Backup từng partition song song.

---

## 2. Strategy: Range partitioning

```sql
CREATE TABLE room_message (
  -- ... columns ...
  created_at timestamptz NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- 1 partition / tháng
CREATE TABLE room_message_2026_05 PARTITION OF room_message
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
```

**Partition naming:** `<table>_YYYY_MM`

**Retention policy:**
- `room_message`: keep 2 year hot, 5 year cold (archive R2)
- `review`: keep forever (FSRS training data quá quý)
- `room_event`: keep 1 year (audit) → archive S3 Glacier
- `audit_log`: keep 7 year (compliance)

---

## 3. Migration plan (production)

### Phase A — Prep (1 tuần trước)

1. **Audit query patterns:**
   ```sql
   SELECT query, calls, mean_exec_time
   FROM pg_stat_statements
   WHERE query ILIKE '%room_message%'
   ORDER BY mean_exec_time DESC LIMIT 20;
   ```
   Verify mọi WHERE đều có `created_at` predicate (cho partition prune).

2. **Foreign key audit:**
   ```sql
   SELECT conname, conrelid::regclass, confrelid::regclass
   FROM pg_constraint
   WHERE confrelid = 'room_message'::regclass;
   ```
   Partition KHÔNG hỗ trợ FK trỏ vào (PostgreSQL 16-). Phải drop FK trước
   khi convert, hoặc dùng trigger-based reference.

3. **Backup point-in-time:** Neon branch + snapshot R2.

### Phase B — Shadow table (dual-write 1-2 tuần)

```sql
-- 1. Tạo bảng partitioned mới (suffix _new)
CREATE TABLE room_message_new (LIKE room_message INCLUDING ALL)
  PARTITION BY RANGE (created_at);

-- 2. Tạo partition cho period hiện tại + tương lai
CREATE TABLE room_message_new_2026_05 PARTITION OF room_message_new
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE room_message_new_2026_06 PARTITION OF room_message_new
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
-- ... tới cuối năm

-- 3. Default partition cho dữ liệu cũ (sẽ migrate sau)
CREATE TABLE room_message_new_archive PARTITION OF room_message_new
  DEFAULT;

-- 4. Trigger dual-write trên bảng cũ
CREATE OR REPLACE FUNCTION dual_write_room_message() RETURNS trigger AS $$
BEGIN
  INSERT INTO room_message_new VALUES (NEW.*);
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_dual_write_room_message
  AFTER INSERT ON room_message
  FOR EACH ROW EXECUTE FUNCTION dual_write_room_message();
```

App code KHÔNG thay đổi — vẫn ghi vào `room_message`, trigger sao chép sang `room_message_new`.

### Phase C — Backfill (chạy nền 2-3 ngày)

```sql
-- Batch copy 10K row/lần để tránh long-running TX
DO $$
DECLARE
  batch_size int := 10000;
  last_id text := '';
  rows_done int := 0;
BEGIN
  LOOP
    INSERT INTO room_message_new
    SELECT * FROM room_message
    WHERE id > last_id
    ORDER BY id LIMIT batch_size
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS rows_done = ROW_COUNT;
    EXIT WHEN rows_done = 0;

    SELECT id INTO last_id FROM room_message_new ORDER BY id DESC LIMIT 1;
    RAISE NOTICE 'Backfilled up to %, % rows', last_id, rows_done;

    PERFORM pg_sleep(0.1); -- ease replica lag
  END LOOP;
END $$;
```

Verify count match:
```sql
SELECT
  (SELECT count(*) FROM room_message) AS old_count,
  (SELECT count(*) FROM room_message_new) AS new_count;
```

### Phase D — Cutover (downtime ~30 giây)

**Window:** 02:00-03:00 UTC (off-peak VN). Status page banner 24h advance.

```sql
BEGIN;

-- Final sync — bắt row cuối cùng vào trigger
INSERT INTO room_message_new
SELECT * FROM room_message
WHERE id NOT IN (SELECT id FROM room_message_new);

-- Drop trigger
DROP TRIGGER trg_dual_write_room_message ON room_message;

-- Rename swap
ALTER TABLE room_message RENAME TO room_message_old;
ALTER TABLE room_message_new RENAME TO room_message;

-- Rename child partitions (consistency naming)
ALTER TABLE room_message_new_2026_05 RENAME TO room_message_2026_05;
ALTER TABLE room_message_new_2026_06 RENAME TO room_message_2026_06;

-- Recreate indexes (đã có từ INCLUDING ALL nhưng verify)
COMMIT;
```

Verify app vẫn ghi/đọc OK qua synthetic test.

### Phase E — Cleanup (2 tuần sau, sau khi confirm stable)

```sql
-- Backup bảng cũ sang R2 trước khi drop
pg_dump --table=room_message_old > room_message_old_archived.sql

-- Drop
DROP TABLE room_message_old;
```

### Phase F — Automation forward

**Cron job tự tạo partition tương lai 1 tháng:**

```sql
CREATE OR REPLACE FUNCTION create_next_month_partition(tbl text) RETURNS void AS $$
DECLARE
  next_start date := date_trunc('month', NOW() + interval '1 month');
  next_end date := next_start + interval '1 month';
  partition_name text := format('%s_%s', tbl, to_char(next_start, 'YYYY_MM'));
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
    partition_name, tbl, next_start, next_end
  );
END $$ LANGUAGE plpgsql;
```

Inngest cron `0 0 1 * *` (1st of month) gọi:
```typescript
inngest.createFunction(
  { id: 'partition-create-next' },
  { cron: '0 0 1 * *' },
  async () => {
    await db.execute(sql`SELECT create_next_month_partition('room_message')`);
    await db.execute(sql`SELECT create_next_month_partition('review')`);
    await db.execute(sql`SELECT create_next_month_partition('room_event')`);
  },
);
```

---

## 4. Risks + Rollback

### Risks

1. **FK violation** — nếu có table khác trỏ vào room_message qua FK, partition mới không nhận. Mitigation: drop FK trước (chấp nhận eventual consistency) hoặc dùng trigger reference.

2. **Trigger missing edge case** — INSERT bypass trigger nếu dùng `COPY` hoặc `INSERT ... RETURNING` lạ. Verify với pgaudit log.

3. **Replica lag amplify** — dual write 2x WAL throughput. Replica có thể lag 5-10s trong backfill phase. Mitigation: pause heavy analytics query.

4. **Constraint check fail** — partitioned table không support 1 số constraint global (vd UNIQUE không có partition key column).

5. **Postgres version** — partition feature mature từ 14+. Neon mặc định 15-16, OK.

### Rollback

**Phase A-C:** trivial, drop trigger + drop bảng `_new`. No data loss.

**Phase D:**
```sql
BEGIN;
ALTER TABLE room_message RENAME TO room_message_new;
ALTER TABLE room_message_old RENAME TO room_message;
-- App writes resume to old non-partitioned. Lose any data written during
-- cutover window (1-3 min) — manual replay from app log.
COMMIT;
```

**Phase E:** không rollback được (đã drop). Tại sao có Phase E sau 2 tuần.

---

## 5. Apply checklist

- [ ] Audit pg_stat_statements (Phase A.1)
- [ ] Audit FK (Phase A.2)
- [ ] Backup snapshot Neon + R2 cold (Phase A.3)
- [ ] Shadow table created (Phase B)
- [ ] Dual-write trigger active (Phase B)
- [ ] Backfill complete + count match (Phase C)
- [ ] Synthetic test on dev with partitioned schema
- [ ] Cutover scheduled + status page announced
- [ ] Cutover executed + verify (Phase D)
- [ ] 2 weeks monitor stable
- [ ] Cleanup old table + archived (Phase E)
- [ ] Cron partition automation deployed (Phase F)
- [ ] Runbook updated với learnings

---

## 6. References

- [Postgres Docs — Table Partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html)
- [Plan v2 §5.1.1 — Postgres lifecycle](../../scale-up-master-plan.md#511-primary-oltp--postgres-lifecycle)
- [Citus blog — How to partition with zero downtime](https://www.citusdata.com/blog/2017/12/22/postgres-table-partitioning/)
- [pg_partman](https://github.com/pgpartman/pg_partman) — auto-partition extension nếu muốn outsource cron logic
