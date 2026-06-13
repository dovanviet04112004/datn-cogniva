import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { triggerEvent } from '@cogniva/server-core/realtime-emitter';
import { onGroupChanged } from '@cogniva/server-core/cache/invalidate';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../infra/database/prisma.service';
import {
  ALL_PERMISSION_KEYS,
  PermissionsService,
  type GroupRole,
  type PermissionKey,
} from './permissions.service';
import { toCategoryDto, toChannelDto } from './group.mappers';
import {
  createCategorySchema,
  createChannelSchema,
  reorderChannelsSchema,
  updateCategorySchema,
  updateChannelSchema,
} from './dto/groups.dto';

@Injectable()
export class GroupChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  private membership(groupId: string, userId: string) {
    return this.prisma.study_group_member.findUnique({
      where: { group_id_user_id: { group_id: groupId, user_id: userId } },
    });
  }

  async listCategories(uid: string, groupId: string) {
    const me = await this.membership(groupId, uid);
    if (!me) throw new ForbiddenException({ error: 'Not a member' });

    const categories = await this.prisma.study_group_category.findMany({
      where: { group_id: groupId },
      orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
    });
    return { categories: categories.map(toCategoryDto) };
  }

  async createCategory(uid: string, groupId: string, raw: unknown) {
    const me = await this.membership(groupId, uid);
    if (!me) throw new ForbiddenException({ error: 'Not a member' });
    if (!this.permissions.can(me.role as GroupRole, 'channel.create')) {
      throw new ForbiddenException({ error: 'Không có quyền tạo category' });
    }

    const parsed = createCategorySchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ error: parsed.error.flatten() });

    const existing = await this.prisma.study_group_category.findMany({
      where: { group_id: groupId },
      orderBy: { position: 'asc' },
      select: { position: true },
    });
    const last = existing[existing.length - 1];
    const nextPos = last ? last.position + 1 : 0;

    const created = await this.prisma.study_group_category.create({
      data: { id: randomUUID(), group_id: groupId, name: parsed.data.name, position: nextPos },
    });

    return { category: toCategoryDto(created) };
  }

  async updateCategory(uid: string, groupId: string, catId: string, raw: unknown) {
    const me = await this.membership(groupId, uid);
    if (!me) throw new ForbiddenException({ error: 'Not a member' });
    if (!this.permissions.can(me.role as GroupRole, 'channel.update')) {
      throw new ForbiddenException({ error: 'Không có quyền sửa category' });
    }

    const parsed = updateCategorySchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ error: parsed.error.flatten() });

    const result = await this.prisma.study_group_category.updateMany({
      where: { id: catId, group_id: groupId },
      data: {
        ...(parsed.data.name !== undefined && { name: parsed.data.name }),
        ...(parsed.data.position !== undefined && { position: parsed.data.position }),
      },
    });
    if (result.count === 0) throw new NotFoundException({ error: 'Category không tồn tại' });

    const updated = await this.prisma.study_group_category.findUnique({ where: { id: catId } });
    return { category: updated ? toCategoryDto(updated) : undefined };
  }

  async deleteCategory(uid: string, groupId: string, catId: string) {
    const me = await this.membership(groupId, uid);
    if (!me) throw new ForbiddenException({ error: 'Not a member' });
    if (!this.permissions.can(me.role as GroupRole, 'channel.delete')) {
      throw new ForbiddenException({ error: 'Không có quyền xoá category' });
    }

    const result = await this.prisma.study_group_category.deleteMany({
      where: { id: catId, group_id: groupId },
    });
    if (result.count === 0) {
      throw new NotFoundException({ error: 'Category không tồn tại' });
    }

    await onGroupChanged(groupId);

    return { deleted: true };
  }

  async listChannels(uid: string, groupId: string) {
    const me = await this.membership(groupId, uid);
    if (!me) throw new ForbiddenException({ error: 'Not a member' });

    const channels = await this.prisma.study_group_channel.findMany({
      where: { group_id: groupId },
      orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
    });
    return { channels: channels.map(toChannelDto) };
  }

  async getChannel(uid: string, groupId: string, channelId: string) {
    const me = await this.membership(groupId, uid);
    if (!me) throw new ForbiddenException({ error: 'Not a member' });

    const channel = await this.prisma.study_group_channel.findFirst({
      where: { id: channelId, group_id: groupId },
    });
    if (!channel) throw new NotFoundException({ error: 'Channel không tồn tại' });

    return { channel: toChannelDto(channel), myRole: me.role };
  }

  async createChannel(uid: string, groupId: string, raw: unknown) {
    const me = await this.membership(groupId, uid);
    if (!me) throw new ForbiddenException({ error: 'Not a member' });
    if (!this.permissions.can(me.role as GroupRole, 'channel.create')) {
      throw new ForbiddenException({ error: 'Không có quyền tạo channel' });
    }

    const parsed = createChannelSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ error: parsed.error.flatten() });

    const existing = await this.prisma.study_group_channel.findMany({
      where: { group_id: groupId },
      orderBy: { position: 'asc' },
      select: { position: true },
    });
    const last = existing[existing.length - 1];
    const nextPos = last ? (last.position ?? 0) + 1 : 0;

    const created = await this.prisma.study_group_channel.create({
      data: {
        id: randomUUID(),
        group_id: groupId,
        name: parsed.data.name,
        type: parsed.data.type,
        topic: parsed.data.topic ?? null,
        position: nextPos,
        created_by: uid,
        voice_max_participants:
          parsed.data.type === 'VOICE' || parsed.data.type === 'STAGE'
            ? (parsed.data.voiceMaxParticipants ?? null)
            : null,
      },
    });

    if (!created) {
      throw new InternalServerErrorException({ error: 'Tạo channel thất bại' });
    }

    await onGroupChanged(groupId);

    if (created.type === 'VOICE' || created.type === 'STAGE') {
      const updated = await this.prisma.study_group_channel.update({
        where: { id: created.id },
        data: { livekit_room_name: `group:${created.id}` },
      });
      return { channel: toChannelDto(updated) };
    }

    return { channel: toChannelDto(created) };
  }

  async updateChannel(uid: string, groupId: string, channelId: string, raw: unknown) {
    const me = await this.membership(groupId, uid);
    if (!me) throw new ForbiddenException({ error: 'Not a member' });
    if (!this.permissions.can(me.role as GroupRole, 'channel.update')) {
      throw new ForbiddenException({ error: 'Không có quyền sửa channel' });
    }

    const parsed = updateChannelSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ error: parsed.error.flatten() });

    const result = await this.prisma.study_group_channel.updateMany({
      where: { id: channelId, group_id: groupId },
      data: {
        ...(parsed.data.name !== undefined && { name: parsed.data.name }),
        ...(parsed.data.topic !== undefined && { topic: parsed.data.topic }),
        ...(parsed.data.position !== undefined && { position: parsed.data.position }),
        ...(parsed.data.slowModeSeconds !== undefined && {
          slow_mode_seconds: parsed.data.slowModeSeconds,
        }),
        ...(parsed.data.voiceMaxParticipants !== undefined && {
          voice_max_participants: parsed.data.voiceMaxParticipants,
        }),
        ...(parsed.data.categoryId !== undefined && { category_id: parsed.data.categoryId }),
        ...(parsed.data.availableTags !== undefined && {
          available_tags:
            parsed.data.availableTags === null
              ? Prisma.DbNull
              : (parsed.data.availableTags as Prisma.InputJsonValue),
        }),
      },
    });

    if (result.count === 0) throw new NotFoundException({ error: 'Channel không tồn tại' });

    await onGroupChanged(groupId);

    const updated = await this.prisma.study_group_channel.findUnique({ where: { id: channelId } });
    return { channel: updated ? toChannelDto(updated) : undefined };
  }

  async deleteChannel(uid: string, groupId: string, channelId: string) {
    const me = await this.membership(groupId, uid);
    if (!me) throw new ForbiddenException({ error: 'Not a member' });
    if (!this.permissions.can(me.role as GroupRole, 'channel.delete')) {
      throw new ForbiddenException({ error: 'Không có quyền xoá channel' });
    }

    const count = await this.prisma.study_group_channel.count({
      where: { group_id: groupId },
    });
    if (count <= 1) {
      throw new BadRequestException({
        error: 'Group phải có ít nhất 1 channel — tạo channel khác trước',
      });
    }

    const result = await this.prisma.study_group_channel.deleteMany({
      where: { id: channelId, group_id: groupId },
    });
    if (result.count === 0) {
      throw new NotFoundException({ error: 'Channel không tồn tại' });
    }

    await onGroupChanged(groupId);

    return { deleted: true };
  }

  async reorderChannels(uid: string, groupId: string, raw: unknown) {
    const me = await this.membership(groupId, uid);
    if (!me) throw new ForbiddenException({ error: 'Not a member' });
    if (!this.permissions.can(me.role as GroupRole, 'channel.reorder')) {
      throw new ForbiddenException({ error: 'Không có quyền sắp xếp' });
    }

    const parsed = reorderChannelsSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ error: parsed.error.flatten() });

    await this.prisma.$transaction(async (tx) => {
      for (const { id, position } of parsed.data.orders) {
        await tx.study_group_channel.updateMany({
          where: { id, group_id: groupId },
          data: { position },
        });
      }
    });

    await onGroupChanged(groupId);

    return { updated: parsed.data.orders.length };
  }

  async typing(uid: string, groupId: string, channelId: string) {
    const [member, channel, u] = await Promise.all([
      this.membership(groupId, uid),
      this.prisma.study_group_channel.findFirst({
        where: { id: channelId, group_id: groupId },
        select: { id: true },
      }),
      this.prisma.user.findUnique({ where: { id: uid }, select: { name: true, image: true } }),
    ]);
    if (!member) throw new ForbiddenException({ error: 'Forbidden' });
    if (!channel) throw new NotFoundException({ error: 'Channel not found' });

    void triggerEvent(`private-channel-${channelId}`, 'user:typing', {
      userId: uid,
      name: u?.name ?? 'Ai đó',
      image: u?.image ?? null,
      expiresAt: Date.now() + 4_000,
    }).catch(() => {});

    return { ok: true };
  }
}
