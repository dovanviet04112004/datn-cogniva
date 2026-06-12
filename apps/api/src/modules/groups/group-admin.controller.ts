import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
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

  @Get(':id/categories')
  listCategories(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.channels.listCategories(user.id, id);
  }

  @Post(':id/categories')
  createCategory(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
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

  @Get(':id/channels')
  listChannels(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.channels.listChannels(user.id, id);
  }

  @Post(':id/channels')
  createChannel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.channels.createChannel(user.id, id, raw);
  }

  @Get(':id/channels/:channelId')
  channelDetail(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('channelId') channelId: string,
  ) {
    return this.channels.getChannel(user.id, id, channelId);
  }

  @Post(':id/channels/reorder')
  @HttpCode(200)
  reorderChannels(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
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

  @Post(':id/channels/:channelId/typing')
  @HttpCode(200)
  typing(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('channelId') channelId: string,
  ) {
    return this.channels.typing(user.id, id, channelId);
  }

  @Get(':id/invites')
  listInvites(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.members.listInvites(user.id, id);
  }

  @Post(':id/invites')
  createInvite(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
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

  @Get(':id/roles')
  listRoles(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.members.listRoles(user.id, id);
  }

  @Post(':id/roles')
  createRole(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
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
