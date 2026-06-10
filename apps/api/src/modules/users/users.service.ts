/**
 * UsersService — profile (me/public) + user status. Port từ
 * apps/web/src/app/api/{profile,user/status} — GIỮ NGUYÊN wire shape
 * (field camelCase như Drizzle alias cũ) + cùng cache key/TTL/invalidator
 * (@cogniva/server-core) nên Next/Nest sống chung không lệch cache.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { cached } from '@cogniva/server-core/cache/cache-aside';
import { ck } from '@cogniva/server-core/cache/keys';
import { onProfileChanged } from '@cogniva/server-core/cache/invalidate';
import { triggerEvent } from '@cogniva/server-core/realtime-emitter';

import { PrismaService } from '../../infra/database/prisma.service';

/** Shape stats trả về client — khớp row userStats cũ (camelCase). */
interface StatsDto {
  userId: string;
  xp: number;
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: string | null;
  achievements: string[];
  updatedAt?: Date | string;
}

const EMPTY_STATS = (userId: string): StatsDto => ({
  userId,
  xp: 0,
  currentStreak: 0,
  longestStreak: 0,
  lastActivityDate: null,
  achievements: [],
});

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  private toStatsDto(s: {
    user_id: string;
    xp: number;
    current_streak: number;
    longest_streak: number;
    last_activity_date: string | null;
    achievements: string[];
    updated_at: Date;
  }): StatsDto {
    return {
      userId: s.user_id,
      xp: s.xp,
      currentStreak: s.current_streak,
      longestStreak: s.longest_streak,
      lastActivityDate: s.last_activity_date,
      achievements: s.achievements,
      updatedAt: s.updated_at,
    };
  }

  /** GET /profile/me — TTL 120s; bust bởi onXpChanged + onProfileChanged. */
  async getProfileMe(userId: string) {
    const data = await cached(ck.profileMe(userId), 120, async () => {
      const [userRow, stats] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, name: true, email: true, image: true, plan: true, is_public: true, created_at: true },
        }),
        this.prisma.user_stats.findUnique({ where: { user_id: userId } }),
      ]);
      return {
        user: userRow
          ? {
              id: userRow.id,
              name: userRow.name,
              email: userRow.email,
              image: userRow.image,
              plan: userRow.plan,
              isPublic: userRow.is_public,
              createdAt: userRow.created_at,
            }
          : null,
        stats: stats ? this.toStatsDto(stats) : null,
      };
    });

    if (!data.user) throw new NotFoundException({ error: 'User not found' });
    return { user: data.user, stats: data.stats ?? EMPTY_STATS(userId) };
  }

  /** PATCH /profile/me — đổi tên/visibility rồi bust cache profile. */
  async updateProfileMe(userId: string, input: { isPublic?: boolean; name?: string }) {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.isPublic !== undefined && { is_public: input.isPublic }),
        ...(input.name !== undefined && { name: input.name }),
        updated_at: new Date(),
      },
      select: { id: true, name: true, is_public: true },
    });
    await onProfileChanged(userId);
    return { user: { id: updated.id, name: updated.name, isPublic: updated.is_public } };
  }

  /**
   * GET /profile/:id — public profile, KHÔNG leak existence (private/không
   * tồn tại → null, cache cả null chống stampede). TTL 300s.
   */
  async getPublicProfile(id: string) {
    return cached(ck.profilePublic(id), 300, async () => {
      const userRow = await this.prisma.user.findFirst({
        where: { id, is_public: true },
        select: { id: true, name: true, image: true, plan: true, created_at: true },
      });
      if (!userRow) return null;

      const stats = await this.prisma.user_stats.findUnique({
        where: { user_id: id },
        select: { xp: true, current_streak: true, longest_streak: true, achievements: true },
      });
      return {
        user: {
          id: userRow.id,
          name: userRow.name,
          image: userRow.image,
          plan: userRow.plan,
          createdAt: userRow.created_at,
        },
        stats: stats
          ? {
              xp: stats.xp,
              currentStreak: stats.current_streak,
              longestStreak: stats.longest_streak,
              achievements: stats.achievements,
            }
          : { xp: 0, currentStreak: 0, longestStreak: 0, achievements: [] },
      };
    });
  }

  /** GET /user/status — status hiệu lực (expired → fallback 'online'). */
  async getStatus(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, status_text: true, status_emoji: true, status_expires_at: true },
    });
    if (!u) throw new NotFoundException({ error: 'Not found' });

    const effective =
      u.status_expires_at && new Date(u.status_expires_at).getTime() < Date.now() ? 'online' : u.status;
    return {
      status: effective,
      storedStatus: u.status,
      statusText: u.status_text,
      statusEmoji: u.status_emoji,
      statusExpiresAt: u.status_expires_at,
    };
  }

  /** PUT /user/status — update + broadcast `status:change` tới mọi group của user. */
  async updateStatus(
    userId: string,
    input: { status?: string; statusText?: string | null; statusEmoji?: string | null; expiresInSec?: number | null },
  ) {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.status !== undefined && { status: input.status }),
        ...(input.statusText !== undefined && { status_text: input.statusText }),
        ...(input.statusEmoji !== undefined && { status_emoji: input.statusEmoji }),
        ...(input.expiresInSec !== undefined && {
          status_expires_at: input.expiresInSec === null ? null : new Date(Date.now() + input.expiresInSec * 1000),
        }),
      },
      select: { status: true, status_text: true, status_emoji: true, status_expires_at: true },
    });

    // Fan-out realtime tới các group user là member — fire-and-forget như cũ.
    void (async () => {
      try {
        const groups = await this.prisma.study_group_member.findMany({
          where: { user_id: userId },
          select: { group_id: true },
        });
        const payload = {
          userId,
          status: updated.status,
          statusText: updated.status_text,
          statusEmoji: updated.status_emoji,
        };
        for (const g of groups) {
          void triggerEvent(`presence-group-${g.group_id}`, 'status:change', payload);
        }
      } catch {
        /* broadcast best-effort */
      }
    })();

    return {
      status: {
        status: updated.status,
        statusText: updated.status_text,
        statusEmoji: updated.status_emoji,
        statusExpiresAt: updated.status_expires_at,
      },
    };
  }
}
