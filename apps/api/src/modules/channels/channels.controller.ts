import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/session.types';
import { AiReplyService } from './ai-reply.service';
import { ChannelsService } from './channels.service';
import { MessagesService } from './messages.service';
import { solutionSchema, type SolutionInput } from './dto/channels.dto';

@ApiTags('channels')
@Controller('channels')
export class ChannelsController {
  constructor(
    private readonly channels: ChannelsService,
    private readonly messages: MessagesService,
    private readonly aiReply: AiReplyService,
  ) {}

  @Get(':id/messages')
  listMessages(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.messages.listMessages(user.id, channelId, before ?? null, limit);
  }

  @Post(':id/messages')
  postMessage(@CurrentUser() user: AuthUser, @Param('id') channelId: string, @Body() raw: unknown) {
    return this.messages.postMessage(user, channelId, raw);
  }

  @Put(':id/messages/:msgId')
  editMessage(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Param('msgId') msgId: string,
    @Body() raw: unknown,
  ) {
    return this.messages.editMessage(user.id, channelId, msgId, raw);
  }

  @Delete(':id/messages/:msgId')
  deleteMessage(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Param('msgId') msgId: string,
  ) {
    return this.messages.deleteMessage(user.id, channelId, msgId);
  }

  @HttpCode(200)
  @Post(':id/messages/:msgId/react')
  react(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Param('msgId') msgId: string,
    @Body() raw: unknown,
  ) {
    return this.messages.react(user.id, channelId, msgId, raw);
  }

  @HttpCode(200)
  @Post(':id/messages/:msgId/pin')
  pin(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Param('msgId') msgId: string,
  ) {
    return this.messages.togglePin(user.id, channelId, msgId);
  }

  @HttpCode(200)
  @Post(':id/messages/:msgId/solution')
  solution(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Param('msgId') msgId: string,
    @Body(new ZodValidationPipe(solutionSchema)) body: SolutionInput,
  ) {
    return this.messages.markSolution(user.id, channelId, msgId, body);
  }

  @Get(':id/messages/:msgId/history')
  history(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Param('msgId') msgId: string,
  ) {
    return this.messages.history(user.id, channelId, msgId);
  }

  @Get(':id/messages/:msgId/thread')
  threadList(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Param('msgId') msgId: string,
  ) {
    return this.messages.threadList(user.id, channelId, msgId);
  }

  @Post(':id/messages/:msgId/thread')
  threadReply(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Param('msgId') msgId: string,
    @Body() raw: unknown,
  ) {
    return this.messages.threadReply(user, channelId, msgId, raw);
  }

  @Get(':id/threads')
  listThreads(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.channels.listThreads(user.id, channelId, { limit, before, includeArchived });
  }

  @Get(':id/forum')
  listForum(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
    @Query('tag') tag?: string,
    @Query('sort') sort?: string,
  ) {
    return this.channels.listForum(user.id, channelId, { limit, before, tag, sort });
  }

  @Get(':id/pinned')
  listPinned(@CurrentUser() user: AuthUser, @Param('id') channelId: string) {
    return this.channels.listPinned(user.id, channelId);
  }

  @Get(':id/read')
  getReadState(@CurrentUser() user: AuthUser, @Param('id') channelId: string) {
    return this.channels.getReadState(user.id, channelId);
  }

  @HttpCode(200)
  @Post(':id/read')
  markRead(@CurrentUser() user: AuthUser, @Param('id') channelId: string, @Body() raw: unknown) {
    return this.channels.markRead(user.id, channelId, raw);
  }

  @Get(':id/notification-setting')
  getNotificationSetting(@CurrentUser() user: AuthUser, @Param('id') channelId: string) {
    return this.channels.getNotificationSetting(user.id, channelId);
  }

  @Put(':id/notification-setting')
  putNotificationSetting(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Body() raw: unknown,
  ) {
    return this.channels.putNotificationSetting(user.id, channelId, raw);
  }

  @HttpCode(200)
  @Post(':id/ai-reply')
  aiReplyHandler(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Body() raw: unknown,
  ) {
    return this.aiReply.handleAiReply(user, channelId, raw);
  }
}
