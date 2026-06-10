/**
 * /api/groups/:id/* (sub-resource) — categories + channels (CRUD/reorder/
 * typing) + invites + members (mute) + roles. Port từ
 * apps/web/src/app/api/groups/[id]/**. Body để raw `unknown` — service tự
 * safeParse SAU check membership/permission (giữ thứ tự 403/404 trước 400).
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/auth/session.types';
import { GroupChannelsService } from './group-channels.service';
import { GroupMembersService } from './group-members.service';

@ApiTags('groups')
@Controller('groups')
export class GroupAdminController {
  constructor(
    private readonly channels: GroupChannelsService,
    private readonly members: GroupMembersService,
  ) {}

  /* ── Categories ─────────────────────────────────────────── */

  @Get(':id/categories')
  listCategories(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.channels.listCategories(user.id, id);
  }

  /** POST 201 mặc định của Nest = status route cũ. */
  @Post(':id/categories')
  createCategory(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() raw: unknown,
  ) {
    return this.channels.createCategory(user.id, id, raw);
  }

  @Put(':id/categories/:catId')
  updateCategory(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('catId') catId: string,
    @Body() raw: unknown,
  ) {
    return this.channels.updateCategory(user.id, id, catId, raw);
  }

  @Delete(':id/categories/:catId')
  deleteCategory(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('catId') catId: string,
  ) {
    return this.channels.deleteCategory(user.id, id, catId);
  }

  /* ── Channels ───────────────────────────────────────────── */

  @Get(':id/channels')
  listChannels(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.channels.listChannels(user.id, id);
  }

  @Post(':id/channels')
  createChannel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() raw: unknown,
  ) {
    return this.channels.createChannel(user.id, id, raw);
  }

  /** POST /groups/:id/channels/reorder — drag-drop bulk (route cũ trả 200). */
  @Post(':id/channels/reorder')
  @HttpCode(200)
  reorderChannels(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() raw: unknown,
  ) {
    return this.channels.reorderChannels(user.id, id, raw);
  }

  @Put(':id/channels/:channelId')
  updateChannel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('channelId') channelId: string,
    @Body() raw: unknown,
  ) {
    return this.channels.updateChannel(user.id, id, channelId, raw);
  }

  @Delete(':id/channels/:channelId')
  deleteChannel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('channelId') channelId: string,
  ) {
    return this.channels.deleteChannel(user.id, id, channelId);
  }

  /** POST typing — ephemeral broadcast (route cũ trả 200). */
  @Post(':id/channels/:channelId/typing')
  @HttpCode(200)
  typing(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('channelId') channelId: string,
  ) {
    return this.channels.typing(user.id, id, channelId);
  }

  /* Route permission-overrides (V2 G1) + bulk member-roles KHÔNG port —
     0 caller (caller-analysis Wave 4); engine PermissionsService vẫn ĐỌC
     override từ DB nếu có. */

  /* ── Invites ────────────────────────────────────────────── */

  @Get(':id/invites')
  listInvites(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.members.listInvites(user.id, id);
  }

  @Post(':id/invites')
  createInvite(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() raw: unknown,
  ) {
    return this.members.createInvite(user.id, id, raw);
  }

  @Delete(':id/invites/:code')
  revokeInvite(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('code') code: string,
  ) {
    return this.members.revokeInvite(user.id, id, code);
  }

  /* ── Members ────────────────────────────────────────────── */

  @Get(':id/members')
  listMembers(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.members.listMembers(user.id, id);
  }

  @Get(':id/members/:userId')
  memberDetail(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.members.getMemberDetail(user.id, id, userId);
  }

  @Put(':id/members/:userId')
  updateMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() raw: unknown,
  ) {
    return this.members.updateMember(user.id, id, userId, raw);
  }

  @Delete(':id/members/:userId')
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.members.removeMember(user.id, id, userId);
  }

  /** POST mute — route cũ trả 200. */
  @Post(':id/members/:userId/mute')
  @HttpCode(200)
  muteMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() raw: unknown,
  ) {
    return this.members.muteMember(user.id, id, userId, raw);
  }

  @Delete(':id/members/:userId/mute')
  unmuteMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.members.unmuteMember(user.id, id, userId);
  }

  /* ── Roles ──────────────────────────────────────────────── */

  @Get(':id/roles')
  listRoles(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.members.listRoles(user.id, id);
  }

  @Post(':id/roles')
  createRole(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() raw: unknown,
  ) {
    return this.members.createRole(user.id, id, raw);
  }

  @Put(':id/roles/:roleId')
  updateRole(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('roleId') roleId: string,
    @Body() raw: unknown,
  ) {
    return this.members.updateRole(user.id, id, roleId, raw);
  }

  @Delete(':id/roles/:roleId')
  deleteRole(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('roleId') roleId: string,
  ) {
    return this.members.deleteRole(user.id, id, roleId);
  }
}
