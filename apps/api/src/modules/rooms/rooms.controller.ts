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

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.rooms.listRooms(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createRoomSchema)) body: CreateRoomInput,
  ) {
    return this.rooms.createRoom(user.id, body);
  }

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

  @Post(':id/token')
  @HttpCode(200)
  token(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(roomTokenSchema)) body: RoomTokenInput,
  ) {
    return this.rooms.issueToken(user, id, body);
  }

  @Post(':id/collab-token')
  @HttpCode(200)
  collabToken(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.rooms.issueCollabToken(user.id, id, raw);
  }

  @Get(':id/chat')
  listChat(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chat.listMessages(user.id, id);
  }

  @Post(':id/chat')
  @HttpCode(200)
  postChat(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.chat.postMessage(user, id, raw);
  }

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

  @Post(':id/moderate')
  @HttpCode(200)
  moderate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(moderateSchema)) body: ModerateInput,
  ) {
    return this.rooms.moderate(user.id, id, body);
  }

  @Post(':id/record')
  @HttpCode(200)
  startRecord(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.recordings.startRecording(user, id);
  }

  @Get(':id/record')
  listRecord(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.recordings.listRecordings(user.id, id);
  }

  @Get(':id/record/:recordingId')
  getRecord(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('recordingId') recordingId: string,
  ) {
    return this.recordings.getRecording(user.id, id, recordingId);
  }

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
