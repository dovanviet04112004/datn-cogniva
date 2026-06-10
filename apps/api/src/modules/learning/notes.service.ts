/**
 * NotesService — CRUD note + AI inline completion. Port từ
 * apps/web/src/app/api/notes/** — GIỮ NGUYÊN wire shape (camelCase như
 * Drizzle alias cũ) + cùng invalidator (@cogniva/server-core) để Next/Nest
 * sống chung không lệch cache.
 *
 * 2 mảng copy thuần (không require được từ web/CJS — đồng bộ tay khi đổi):
 *   - awardXp + achievement checks: copy từ apps/web/src/lib/gamification/{xp,achievements}.ts
 *   - completeNote: copy từ apps/web/src/lib/notes/complete.ts + lib/ai/models.ts,
 *     nhưng apps/api KHÔNG có @ai-sdk/* providers → gọi REST OpenAI-compatible
 *     trực tiếp (cùng provider pick order / model default / params).
 */
import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type note as NoteRow } from '@prisma/client';
import { ACHIEVEMENT_META } from '@cogniva/server-core';
import { onWorkspaceContentChanged, onXpChanged } from '@cogniva/server-core/cache/invalidate';

import { PrismaService } from '../../infra/database/prisma.service';
import type { CreateNoteInput, UpdateNoteInput } from './dto/notes.dto';

/** Shape note trả client — khớp row Drizzle cũ (camelCase, theo thứ tự cột schema). */
interface NoteDto {
  id: string;
  userId: string;
  workspaceId: string | null;
  title: string;
  content: string;
  conceptId: string | null;
  documentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ──────────────────────────────────────────────────────────────────────────
// Gamification (copy từ web lib — xem header file)
// ──────────────────────────────────────────────────────────────────────────

/** XP cho note tạo mới — XP_AMOUNTS.NOTE_CREATE cũ. */
const XP_NOTE_CREATE = 3;

type UserStatsRow = {
  userId: string;
  xp: number;
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: string | null;
  achievements: string[];
};

type AchievementContext = {
  source: 'flashcard' | 'quiz' | 'note' | 'document' | 'streak';
  totalCount?: number;
};

/** Logic unlock theo id — metadata (label/icon) ở ACHIEVEMENT_META (server-core). */
const ACHIEVEMENT_CHECKS: Record<string, (s: UserStatsRow, c: AchievementContext) => boolean> = {
  first_upload: (_s, c) => c.source === 'document' && (c.totalCount ?? 0) >= 1,
  first_quiz: (_s, c) => c.source === 'quiz' && (c.totalCount ?? 0) >= 1,
  first_note: (_s, c) => c.source === 'note' && (c.totalCount ?? 0) >= 1,
  first_flashcard: (_s, c) => c.source === 'flashcard' && (c.totalCount ?? 0) >= 1,
  xp_100: (s) => s.xp >= 100,
  xp_500: (s) => s.xp >= 500,
  xp_1000: (s) => s.xp >= 1000,
  streak_3: (s) => s.currentStreak >= 3,
  streak_7: (s) => s.currentStreak >= 7,
  streak_30: (s) => s.currentStreak >= 30,
};

// ──────────────────────────────────────────────────────────────────────────
// AI completion (copy từ lib/notes/complete.ts — prompt giữ nguyên từng chữ)
// ──────────────────────────────────────────────────────────────────────────

const INSTRUCTION = `Bạn là trợ lý viết note. Đoạn dưới là text mà người dùng đã viết. Hãy tiếp tục mạch văn bằng 1-2 câu NGẮN GỌN, đúng phong cách họ đang dùng.

QUY TẮC:
- Tiếp tục TRỰC TIẾP (không có dấu "..." đầu, không lặp câu trước).
- 1-2 câu, ≤ 40 từ.
- Cùng ngôn ngữ với đoạn văn (nếu họ viết tiếng Việt, trả tiếng Việt).
- Không thêm metadata/comment/markdown — chỉ text thuần.

ĐOẠN VĂN ĐÃ VIẾT:
"""
{{PREFIX}}
"""

TIẾP TỤC:`;

type ChatProvider = 'anthropic' | 'groq' | 'google' | 'openrouter';

@Injectable()
export class NotesService {
  constructor(private readonly prisma: PrismaService) {}

  private toNoteDto(row: NoteRow): NoteDto {
    return {
      id: row.id,
      userId: row.user_id,
      workspaceId: row.workspace_id,
      title: row.title,
      content: row.content,
      conceptId: row.concept_id,
      documentId: row.document_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * GET /notes — list theo workspace filter:
   *   workspaceParam = 'null' → notes "Personal" (workspace_id IS NULL)
   *   workspaceParam = 'X'    → notes thuộc workspace X
   *   workspaceParam = null   → tất cả notes của user
   */
  async listNotes(
    userId: string,
    opts: { limit: number; offset: number; workspaceParam: string | null },
  ) {
    const where: Prisma.noteWhereInput = { user_id: userId };
    if (opts.workspaceParam === 'null') where.workspace_id = null;
    else if (opts.workspaceParam) where.workspace_id = opts.workspaceParam;

    const rows = await this.prisma.note.findMany({
      where,
      orderBy: { updated_at: 'desc' },
      take: opts.limit,
      skip: opts.offset,
      select: {
        id: true,
        title: true,
        content: true,
        workspace_id: true,
        concept_id: true,
        document_id: true,
        created_at: true,
        updated_at: true,
      },
    });

    // Route cũ select subset KHÔNG có userId — giữ nguyên shape.
    return {
      notes: rows.map((r) => ({
        id: r.id,
        title: r.title,
        content: r.content,
        workspaceId: r.workspace_id,
        conceptId: r.concept_id,
        documentId: r.document_id,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    };
  }

  /** POST /notes — tạo note + thưởng XP + bust workspace stats nếu thuộc workspace. */
  async createNote(userId: string, input: CreateNoteInput) {
    const inserted = await this.prisma.note.create({
      data: {
        // Route cũ để Drizzle $defaultFn sinh cuid2; api dùng randomUUID
        // (convention sẵn của module auth) — đều là text id opaque.
        id: randomUUID(),
        user_id: userId,
        workspace_id: input.workspaceId ?? null,
        title: input.title,
        content: input.content,
        concept_id: input.conceptId ?? null,
        document_id: input.documentId ?? null,
      },
    });

    // Gamification: +3 XP mỗi note mới + check achievement first_note.
    await this.awardXp(userId, XP_NOTE_CREATE, { source: 'note', totalCount: 1 });

    // Note mới đổi badge stats workspace (count notes) — note "Personal" thì không.
    if (inserted.workspace_id) {
      await onWorkspaceContentChanged(userId, inserted.workspace_id);
    }

    return { note: this.toNoteDto(inserted) };
  }

  /** GET /notes/:id — chỉ owner đọc được. */
  async getNote(userId: string, id: string) {
    const row = await this.prisma.note.findFirst({ where: { id, user_id: userId } });
    if (!row) throw new NotFoundException({ error: 'Not found' });
    return { note: this.toNoteDto(row) };
  }

  /** PATCH /notes/:id — partial update title/content, auto-bump updated_at. */
  async updateNote(userId: string, id: string, input: UpdateNoteInput) {
    const existing = await this.prisma.note.findFirst({ where: { id, user_id: userId } });
    if (!existing) throw new NotFoundException({ error: 'Not found' });

    const updated = await this.prisma.note.update({
      where: { id },
      data: {
        title: input.title ?? existing.title,
        content: input.content ?? existing.content,
        updated_at: new Date(),
      },
    });
    return { note: this.toNoteDto(updated) };
  }

  /** DELETE /notes/:id — DELETE..RETURNING như route cũ (atomic, lấy workspaceId để bust). */
  async deleteNote(userId: string, id: string) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; workspace_id: string | null }>>(
      Prisma.sql`DELETE FROM note WHERE id = ${id} AND user_id = ${userId} RETURNING id, workspace_id`,
    );
    if (rows.length === 0) throw new NotFoundException({ error: 'Not found' });

    const deletedWorkspaceId = rows[0]?.workspace_id;
    if (deletedWorkspaceId) {
      await onWorkspaceContentChanged(userId, deletedWorkspaceId);
    }
    return { deleted: true };
  }

  // ────────────────────────────────────────────────────────────────────────
  // POST /notes/complete — AI inline completion (logic completeNote cũ)
  // ────────────────────────────────────────────────────────────────────────

  /** Sinh completion ngắn cho 1 prefix. Trả '' nếu fail (cùng fail-soft như cũ). */
  async completeNote(prefix: string): Promise<string> {
    const trimmed = prefix.trim();
    if (trimmed.length < 20) return ''; // ít context → bỏ qua

    // Cắt prefix về 500 ký tự cuối để tiết kiệm token + tăng relevance
    const cap = trimmed.length > 500 ? trimmed.slice(-500) : trimmed;

    try {
      const text = await this.generateCompletion(INSTRUCTION.replace('{{PREFIX}}', cap));
      // Loại bỏ leading whitespace/newline + trailing markdown noise
      return text.trim().replace(/^["']|["']$/g, '');
    } catch (err) {
      console.warn('[note-complete] fail:', (err as Error).message);
      return '';
    }
  }

  /** Provider pick order copy từ lib/ai/models.ts pickChatProvider(). */
  private pickChatProvider(): ChatProvider {
    const forced = process.env.LLM_PROVIDER as ChatProvider | undefined;
    if (forced && ['anthropic', 'openrouter', 'groq', 'google'].includes(forced)) return forced;
    if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
    if (process.env.GROQ_API_KEY) return 'groq';
    if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return 'google';
    if (process.env.OPENROUTER_API_KEY) return 'openrouter';
    throw new Error('[ai] Không tìm thấy AI provider key (ANTHROPIC/GROQ/GOOGLE/OPENROUTER)');
  }

  /**
   * Gọi LLM 1 lượt (temperature 0.6, max 120 token — như generateText cũ).
   * REST trực tiếp vì apps/api chưa cài @ai-sdk/* providers; model default
   * mỗi provider giữ nguyên theo lib/ai/models.ts.
   */
  private async generateCompletion(prompt: string): Promise<string> {
    const provider = this.pickChatProvider();

    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 120,
          temperature: 0.6,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}`);
      const json = (await res.json()) as { content?: Array<{ text?: string }> };
      return json.content?.[0]?.text ?? '';
    }

    // 3 provider còn lại đều OpenAI-compatible chat/completions.
    const cfg: Record<
      Exclude<ChatProvider, 'anthropic'>,
      { url: string; key: string; model: string; headers: Record<string, string> }
    > = {
      groq: {
        url: 'https://api.groq.com/openai/v1/chat/completions',
        key: process.env.GROQ_API_KEY ?? '',
        model: 'llama-3.3-70b-versatile',
        headers: {},
      },
      google: {
        url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        key: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '',
        model: 'gemini-2.5-flash',
        headers: {},
      },
      openrouter: {
        url: 'https://openrouter.ai/api/v1/chat/completions',
        key: process.env.OPENROUTER_API_KEY ?? '',
        model: 'openai/gpt-oss-20b:free',
        headers: {
          'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
          'X-Title': 'Cogniva',
        },
      },
    };
    const c = cfg[provider];

    const res = await fetch(c.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${c.key}`, ...c.headers },
      body: JSON.stringify({
        model: c.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.6,
        max_tokens: 120,
      }),
    });
    if (!res.ok) throw new Error(`${provider} ${res.status}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content ?? '';
  }

  // ────────────────────────────────────────────────────────────────────────
  // awardXp — copy từ apps/web/src/lib/gamification/xp.ts (choke point XP:
  // update stats + streak + achievements rồi onXpChanged bust cache/ZSET)
  // ────────────────────────────────────────────────────────────────────────

  /** YYYY-MM-DD (UTC) — đủ cho v1, không quá khác giờ VN +7 (như lib cũ). */
  private todayString(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /** Tính streak mới: hôm nay giữ nguyên, hôm qua +1, còn lại reset về 1. */
  private computeStreak(lastDate: string | null, currentStreak: number): number {
    const today = this.todayString();
    if (lastDate === today) return currentStreak;

    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    if (lastDate === yesterday.toISOString().slice(0, 10)) return currentStreak + 1;
    return 1;
  }

  /** Đảm bảo có row user_stats — upsert idempotent. */
  private async ensureStats(userId: string): Promise<UserStatsRow> {
    const row =
      (await this.prisma.user_stats.findUnique({ where: { user_id: userId } })) ??
      (await this.prisma.user_stats.create({ data: { user_id: userId } }));
    return {
      userId: row.user_id,
      xp: row.xp,
      currentStreak: row.current_streak,
      longestStreak: row.longest_streak,
      lastActivityDate: row.last_activity_date,
      achievements: row.achievements,
    };
  }

  /** Check toàn bộ achievements, trả list id MỚI unlock so với list hiện có. */
  private checkNewAchievements(stats: UserStatsRow, ctx: AchievementContext): string[] {
    const already = new Set(stats.achievements);
    const unlocked: string[] = [];
    for (const meta of ACHIEVEMENT_META) {
      if (already.has(meta.id)) continue;
      const check = ACHIEVEMENT_CHECKS[meta.id];
      if (check && check(stats, ctx)) unlocked.push(meta.id);
    }
    return unlocked;
  }

  /** Award XP + cập nhật streak + merge achievement mới (race nhỏ chấp nhận như v1). */
  private async awardXp(userId: string, amount: number, ctx: AchievementContext): Promise<void> {
    if (amount < 0) amount = 0;
    const current = await this.ensureStats(userId);
    const newStreak = this.computeStreak(current.lastActivityDate, current.currentStreak);
    const today = this.todayString();

    const nextStats: UserStatsRow = {
      ...current,
      xp: current.xp + amount,
      currentStreak: newStreak,
      longestStreak: Math.max(current.longestStreak, newStreak),
      lastActivityDate: today,
    };

    const unlocked = this.checkNewAchievements(nextStats, ctx);
    const merged = unlocked.length ? [...nextStats.achievements, ...unlocked] : nextStats.achievements;

    await this.prisma.user_stats.update({
      where: { user_id: userId },
      data: {
        xp: nextStats.xp,
        current_streak: nextStats.currentStreak,
        longest_streak: nextStats.longestStreak,
        last_activity_date: today,
        achievements: merged,
        updated_at: new Date(),
      },
    });

    // Choke point: bust profile/dashboard + cộng ZSET leaderboard (fail-open).
    await onXpChanged(userId, amount);
  }
}
