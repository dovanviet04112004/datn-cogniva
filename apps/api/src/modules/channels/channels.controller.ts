/**
 * /api/channels/:id/* (text/forum/thread core) — port từ route Next
 * (apps/web/src/app/api/channels/[id]/**). Mọi route cần session (guard
 * mặc định lo 401 {error:'Unauthorized'}).
 *
 * Status code khớp route cũ: POST messages + thread reply trả 201 (default
 * Nest); POST react/pin/solution/read/ai-reply trả 200 → @HttpCode(200).
 * Body hầu hết safeParse TRONG service vì route cũ check 404/403/423 trước
 * khi parse (riêng solution parse trước → qua ZodValidationPipe).
 * Route voice/stage/record/collab-token thuộc agent channels-voice (module riêng).
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
  Query,
} from '@nestjs/common';
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

  /** GET /channels/:id/messages?before=msgId&limit=50 — cursor pagination. */
  @Get(':id/messages')
  listMessages(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.messages.listMessages(user.id, channelId, before ?? null, limit);
  }

  /** POST /channels/:id/messages — gửi message (201 như route cũ). */
  @Post(':id/messages')
  postMessage(@CurrentUser() user: AuthUser, @Param('id') channelId: string, @Body() raw: unknown) {
    return this.messages.postMessage(user, channelId, raw);
  }

  /** PUT /channels/:id/messages/:msgId — edit own message (+ revision snapshot). */
  @Put(':id/messages/:msgId')
  editMessage(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Param('msgId') msgId: string,
    @Body() raw: unknown,
  ) {
    return this.messages.editMessage(user.id, channelId, msgId, raw);
  }

  /** DELETE /channels/:id/messages/:msgId — soft-delete (author hoặc MOD+). */
  @Delete(':id/messages/:msgId')
  deleteMessage(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Param('msgId') msgId: string,
  ) {
    return this.messages.deleteMessage(user.id, channelId, msgId);
  }

  /** POST /channels/:id/messages/:msgId/react — toggle reaction (route cũ 200). */
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

  /** POST /channels/:id/messages/:msgId/pin — toggle pin, MODERATOR+ (200). */
  @HttpCode(200)
  @Post(':id/messages/:msgId/pin')
  pin(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Param('msgId') msgId: string,
  ) {
    return this.messages.togglePin(user.id, channelId, msgId);
  }

  /** POST /channels/:id/messages/:msgId/solution — V2 G5.4 forum solution (200). */
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

  /** GET /channels/:id/messages/:msgId/history — V2 G2.7 edit revisions. */
  @Get(':id/messages/:msgId/history')
  history(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Param('msgId') msgId: string,
  ) {
    return this.messages.history(user.id, channelId, msgId);
  }

  /** GET /channels/:id/messages/:msgId/thread — root + replies. */
  @Get(':id/messages/:msgId/thread')
  threadList(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Param('msgId') msgId: string,
  ) {
    return this.messages.threadList(user.id, channelId, msgId);
  }

  /** POST /channels/:id/messages/:msgId/thread — reply vào thread (201). */
  @Post(':id/messages/:msgId/thread')
  threadReply(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Param('msgId') msgId: string,
    @Body() raw: unknown,
  ) {
    return this.messages.threadReply(user, channelId, msgId, raw);
  }

  /** GET /channels/:id/threads — V2 G6.3 active threads panel. */
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

  /** GET /channels/:id/forum — V3 forum posts list. */
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

  /** GET /channels/:id/pinned — popover pinned messages. */
  @Get(':id/pinned')
  listPinned(@CurrentUser() user: AuthUser, @Param('id') channelId: string) {
    return this.channels.listPinned(user.id, channelId);
  }

  /** GET /channels/:id/read — lastReadMessageId cho unread divider. */
  @Get(':id/read')
  getReadState(@CurrentUser() user: AuthUser, @Param('id') channelId: string) {
    return this.channels.getReadState(user.id, channelId);
  }

  /** POST /channels/:id/read — mark đã đọc tới message X (route cũ 200). */
  @HttpCode(200)
  @Post(':id/read')
  markRead(@CurrentUser() user: AuthUser, @Param('id') channelId: string, @Body() raw: unknown) {
    return this.channels.markRead(user.id, channelId, raw);
  }

  /** GET /channels/:id/notification-setting — V2 G4.1 per-channel preference. */
  @Get(':id/notification-setting')
  getNotificationSetting(@CurrentUser() user: AuthUser, @Param('id') channelId: string) {
    return this.channels.getNotificationSetting(user.id, channelId);
  }

  /** PUT /channels/:id/notification-setting — upsert preference. */
  @Put(':id/notification-setting')
  putNotificationSetting(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Body() raw: unknown,
  ) {
    return this.channels.putNotificationSetting(user.id, channelId, raw);
  }

  /** POST /channels/:id/ai-reply — AI Tutor reply đồng bộ (route cũ 200). */
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
