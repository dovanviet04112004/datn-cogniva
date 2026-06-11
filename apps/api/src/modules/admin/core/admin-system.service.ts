/**
 * AdminSystemService — flags + maintenance (bảng system_config) + jobs status.
 *
 * Port lib/system/config.ts: cache in-memory Map TTL 5s PER-PROCESS (chấp nhận
 * instance khác stale tối đa 5s — y hành vi cũ, không thêm pub/sub).
 *
 * Jobs: đọc BullMQ qua @InjectQueue 3 queue của api (cron-v2/document/
 * recording); danh sách cron là hằng CRON_JOBS_V2 — web cũ sau W6 trả [] nên
 * nguồn sự thật giờ nằm ở api.
 */
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../infra/database/prisma.service';
import { AdminAuditService } from '../../../common/admin/admin-audit.service';
import type { AdminContext } from '../../../common/admin/admin.guard';
import {
  CRON_QUEUE,
  DOCUMENT_QUEUE,
  RECORDING_QUEUE,
} from '../../../infra/queue/queue.module';
import { CRON_JOBS_V2 } from '../../jobs/cron-jobs';
import type { SetFlagInput, SetMaintenanceInput } from './dto/admin-core.dto';

const CACHE_TTL_MS = 5_000;

export type MaintenanceConfig = {
  enabled: boolean;
  banner: string | null;
  dismissible: boolean;
};

const DEFAULT_MAINTENANCE: MaintenanceConfig = {
  enabled: false,
  banner: null,
  dismissible: true,
};

@Injectable()
export class AdminSystemService {
  /** Cache 5s per-process — service singleton nên Map sống cùng process. */
  private readonly cache = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    @InjectQueue(RECORDING_QUEUE) private readonly recordingQueue: Queue,
    @InjectQueue(DOCUMENT_QUEUE) private readonly documentQueue: Queue,
    @InjectQueue(CRON_QUEUE) private readonly cronQueue: Queue,
  ) {}

  // ── system_config helpers (port lib/system/config.ts) ───────────
  private async getSystemConfig<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.value as T;
    }

    const row = await this.prisma.system_config.findUnique({
      where: { key },
      select: { value: true },
    });
    const value = (row?.value ?? null) as T | null;
    if (value !== null) {
      this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    }
    return value;
  }

  private async setSystemConfig(key: string, value: unknown, updatedBy: string): Promise<void> {
    const now = new Date();
    const json =
      value === null || value === undefined
        ? Prisma.JsonNull
        : (value as Prisma.InputJsonValue);
    await this.prisma.system_config.upsert({
      where: { key },
      create: { key, value: json, updated_by: updatedBy, updated_at: now },
      update: { value: json, updated_by: updatedBy, updated_at: now },
    });
    this.cache.delete(key);
  }

  private async getMaintenanceConfig(): Promise<MaintenanceConfig> {
    const raw = await this.getSystemConfig<MaintenanceConfig>('maintenance');
    if (!raw) return DEFAULT_MAINTENANCE;
    return {
      enabled: !!raw.enabled,
      banner: typeof raw.banner === 'string' ? raw.banner : null,
      dismissible: raw.dismissible !== false,
    };
  }

  // ── GET /admin/system/flags ──────────────────────────────────────
  async listFlags() {
    const rows = await this.prisma.system_config.findMany();
    return {
      flags: rows
        .filter((r) => r.key.startsWith('flags.'))
        .map((r) => ({
          name: r.key.slice('flags.'.length),
          value: r.value,
          updatedBy: r.updated_by,
          updatedAt: r.updated_at.toISOString(),
        })),
    };
  }

  // ── POST /admin/system/flags ─────────────────────────────────────
  async setFlag(ctx: AdminContext, dto: SetFlagInput) {
    const { name, value, reason } = dto;

    await this.audit.withAudit(ctx, 'flag.set', { type: 'flag', id: name }, async () => {
      const existing = await this.prisma.system_config.findUnique({
        where: { key: `flags.${name}` },
        select: { value: true },
      });
      await this.setSystemConfig(`flags.${name}`, value, ctx.userId);
      return {
        before: existing?.value ?? null,
        after: value,
        reason,
        result: { ok: true },
      };
    });

    return { ok: true };
  }

  // ── DELETE /admin/system/flags?name=X&reason=Y ───────────────────
  async deleteFlag(ctx: AdminContext, name: string, reason: string) {
    await this.audit.withAudit(ctx, 'flag.delete', { type: 'flag', id: name }, async () => {
      const existing = await this.prisma.system_config.findUnique({
        where: { key: `flags.${name}` },
        select: { value: true },
      });
      if (!existing) throw new Error('Flag không tồn tại');
      await this.prisma.system_config.deleteMany({ where: { key: `flags.${name}` } });
      this.cache.clear();
      return {
        before: existing.value,
        after: null,
        reason: reason.trim(),
        result: { ok: true },
      };
    });

    return { ok: true };
  }

  // ── GET /admin/system/maintenance ────────────────────────────────
  async getMaintenance() {
    const config = await this.getMaintenanceConfig();
    return { config };
  }

  // ── POST /admin/system/maintenance ───────────────────────────────
  async setMaintenance(ctx: AdminContext, dto: SetMaintenanceInput) {
    const { enabled, banner, dismissible, reason } = dto;

    await this.audit.withAudit(
      ctx,
      enabled ? 'maintenance.enable' : 'maintenance.disable',
      { type: 'system', id: 'maintenance' },
      async () => {
        const before = await this.getMaintenanceConfig();
        const next: MaintenanceConfig = {
          enabled,
          banner: banner === undefined ? before.banner : banner,
          dismissible: dismissible ?? before.dismissible,
        };
        await this.setSystemConfig('maintenance', next, ctx.userId);
        return { before, after: next, reason, result: { ok: true, config: next } };
      },
    );

    return { ok: true };
  }

  // ── GET /admin/system/jobs ───────────────────────────────────────
  async getJobs() {
    let queues: Array<{ name: string; counts: Record<string, number> }> = [];
    let redisOk = true;
    try {
      const defs = [
        { name: 'recording', q: this.recordingQueue },
        { name: 'document', q: this.documentQueue },
        { name: 'cron-v2', q: this.cronQueue },
      ];
      queues = await Promise.all(
        defs.map(async ({ name, q }) => ({
          name,
          counts: await q.getJobCounts('active', 'waiting', 'delayed', 'completed', 'failed'),
        })),
      );
    } catch {
      redisOk = false;
    }

    return {
      queues,
      crons: CRON_JOBS_V2,
      redisConfigured: !!process.env.REDIS_URL,
      redisOk,
    };
  }
}
