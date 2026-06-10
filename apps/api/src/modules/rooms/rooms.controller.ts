/**
 * /api/rooms/* — port từ apps/web/src/app/api/rooms/** (10 route).
 * Status code y route cũ: POST /rooms 201 (Nest default), các POST còn lại
 * @HttpCode(200). Guard mặc định lo 401 {error:'Unauthorized'}.
 */
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { checkLimit } from '@cogniva/server-core/rate-limit';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/session.types';
import { RoomsService } from './rooms.service';
import { RoomChatService } from './room-chat.service';
import { RoomRecordingsService } from './room-recordings.service';
import {
  createRoomSchema,
  moderateSchema,
  roomTokenSchema,
  type CreateRoomInput,
  type ModerateInput,
  type RoomTokenInput,
} from './dto/rooms.dto';

@ApiTags('rooms')
@Controller('rooms')
export class RoomsController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly chat: RoomChatService,
    private readonly recordings: RoomRecordingsService,
  ) {}

  /** GET /rooms — {mine, joined} (cache-aside 60s). */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.rooms.listRooms(user.id);
  }

  /** POST /rooms — tạo room (201 = Nest default, y route cũ). */
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createRoomSchema)) body: CreateRoomInput,
  ) {
    return this.rooms.createRoom(user.id, body);
  }

  /** POST /rooms/join — join qua code (parse trong service: 400 'Invalid body'). */
  @Post('join')
  @HttpCode(200)
  join(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    return this.rooms.joinByCode(user.id, raw);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.rooms.getRoom(user.id, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.rooms.deleteRoom(user.id, id);
  }

  /** POST /rooms/:id/token — LiveKit JWT (parse 400 trước room 404, y route cũ). */
  @Post(':id/token')
  @HttpCode(200)
  token(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(roomTokenSchema)) body: RoomTokenInput,
  ) {
    return this.rooms.issueToken(user, id, body);
  }

  /** POST /rooms/:id/collab-token — Hocuspocus JWT (parse trong service). */
  @Post(':id/collab-token')
  @HttpCode(200)
  collabToken(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.rooms.issueCollabToken(user.id, id, raw);
  }

  @Get(':id/chat')
  listChat(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chat.listMessages(user.id, id);
  }

  /** POST /rooms/:id/chat — member 403 TRƯỚC parse 400 → parse trong service. */
  @Post(':id/chat')
  @HttpCode(200)
  postChat(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.chat.postMessage(user, id, raw);
  }

  /**
   * POST /rooms/:id/ai-message — thứ tự status y route cũ:
   * 403 member → 429 rate-limit (Retry-After) → 400 parse → 404/403 trong service.
   * Rate limit theo PHIÊN HỌC (key gồm roomId), preset aiGenerate 10 req/phút.
   */
  @Post(':id/ai-message')
  @HttpCode(200)
  async aiMessage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() raw: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!(await this.rooms.isActiveMember(id, user.id))) {
      throw new ForbiddenException({ error: 'Not a member of this room' });
    }

    const rl = await checkLimit(`ai-tutor:${id}:${user.id}`, 'aiGenerate');
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfter ?? 60));
      throw new HttpException({ error: 'Quá nhiều câu hỏi AI. Hãy đợi một chút.' }, 429);
    }

    return this.chat.aiMessage(user, id, raw);
  }

  /** POST /rooms/:id/moderate — parse 400 (flatten) TRƯỚC role check, y route cũ. */
  @Post(':id/moderate')
  @HttpCode(200)
  moderate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(moderateSchema)) body: ModerateInput,
  ) {
    return this.rooms.moderate(user.id, id, body);
  }

  /** POST /rooms/:id/record — start composite egress (mod only). */
  @Post(':id/record')
  @HttpCode(200)
  startRecord(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.recordings.startRecording(user, id);
  }

  /** GET /rooms/:id/record — list recordings (member ACTIVE). */
  @Get(':id/record')
  listRecord(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.recordings.listRecordings(user.id, id);
  }

  /** POST /rooms/:id/record/:recordingId/stop — stop egress (idempotent). */
  @Post(':id/record/:recordingId/stop')
  @HttpCode(200)
  stopRecord(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('recordingId') recordingId: string,
  ) {
    return this.recordings.stopRecording(user, id, recordingId);
  }
}
