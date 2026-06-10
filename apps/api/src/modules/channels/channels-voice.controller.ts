/**
 * /api/channels/:id/{voice,stage,record,collab-token} — port từ route Next
 * apps/web/src/app/api/channels/[id]/** (nhánh voice/stage/record/collab).
 *
 * Mọi route cần session (guard mặc định lo 401 {error:'Unauthorized'}).
 * Route cũ POST đều trả 200 → @HttpCode(200) toàn bộ.
 *
 * Body validation:
 *   - voice/state: ZodValidationPipe (route cũ parse body ngay sau session,
 *     error shape {error: flatten()} — pipe khớp).
 *   - stage POST + collab-token: safeParse TRONG service vì route cũ check
 *     403/404 trước hoặc message lỗi custom — giữ THỨ TỰ status + nguyên văn.
 */
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/session.types';
import { VoiceService } from './voice.service';
import { VoiceRecordingsService } from './voice-recordings.service';
import { voiceStateSchema, type VoiceStateInput } from './dto/channels-voice.dto';

@ApiTags('channels-voice')
@Controller('channels')
export class ChannelsVoiceController {
  constructor(
    private readonly voice: VoiceService,
    private readonly recordings: VoiceRecordingsService,
  ) {}

  /* ── Voice ─────────────────────────────────────────────────────────── */

  @HttpCode(200)
  @Post(':id/voice/join')
  joinVoice(@CurrentUser() user: AuthUser, @Param('id') channelId: string) {
    return this.voice.joinVoice(user, channelId);
  }

  @HttpCode(200)
  @Post(':id/voice/leave')
  leaveVoice(@CurrentUser() user: AuthUser, @Param('id') channelId: string) {
    return this.voice.leaveVoice(user.id, channelId);
  }

  @HttpCode(200)
  @Post(':id/voice/state')
  syncVoiceState(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Body(new ZodValidationPipe(voiceStateSchema)) body: VoiceStateInput,
  ) {
    return this.voice.syncVoiceState(user.id, channelId, body);
  }

  @HttpCode(200)
  @Post(':id/voice/token')
  issueVoiceToken(@CurrentUser() user: AuthUser, @Param('id') channelId: string) {
    return this.voice.issueVoiceToken(user, channelId);
  }

  @Get(':id/voice/participants')
  listParticipants(@CurrentUser() user: AuthUser, @Param('id') channelId: string) {
    return this.voice.listParticipants(user.id, channelId);
  }

  /* ── Stage ─────────────────────────────────────────────────────────── */

  @Get(':id/stage')
  getStageState(@CurrentUser() user: AuthUser, @Param('id') channelId: string) {
    return this.voice.getStageState(user, channelId);
  }

  @HttpCode(200)
  @Post(':id/stage')
  raiseHand(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Body() raw: unknown,
  ) {
    return this.voice.raiseHand(user, channelId, raw);
  }

  @HttpCode(200)
  @Post(':id/stage/promote/:userId')
  promoteSpeaker(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Param('userId') targetUserId: string,
  ) {
    return this.voice.promoteSpeaker(user, channelId, targetUserId);
  }

  @HttpCode(200)
  @Post(':id/stage/demote/:userId')
  demoteSpeaker(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Param('userId') targetUserId: string,
  ) {
    return this.voice.demoteSpeaker(user, channelId, targetUserId);
  }

  /* ── Recording ─────────────────────────────────────────────────────── */

  @HttpCode(200)
  @Post(':id/record')
  startRecording(@CurrentUser() user: AuthUser, @Param('id') channelId: string) {
    return this.recordings.startRecording(user, channelId);
  }

  @Get(':id/record')
  listRecordings(@CurrentUser() user: AuthUser, @Param('id') channelId: string) {
    return this.recordings.listRecordings(user.id, channelId);
  }

  @Delete(':id/record/:recordingId')
  deleteRecording(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Param('recordingId') recordingId: string,
  ) {
    return this.recordings.deleteRecording(channelId, recordingId, user.id);
  }

  @HttpCode(200)
  @Post(':id/record/:recordingId/stop')
  stopRecording(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Param('recordingId') recordingId: string,
  ) {
    return this.recordings.stopRecording(user, channelId, recordingId);
  }

  /** ?force=1 → re-process recording đã PROCESSED/FAILED (mod retry). */
  @HttpCode(200)
  @Post(':id/record/:recordingId/sync')
  syncRecording(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Param('recordingId') recordingId: string,
    @Query('force') force?: string,
  ) {
    return this.recordings.syncRecording(user, channelId, recordingId, force === '1');
  }

  /* ── Collab (Hocuspocus) ───────────────────────────────────────────── */

  @HttpCode(200)
  @Post(':id/collab-token')
  issueCollabToken(
    @CurrentUser() user: AuthUser,
    @Param('id') channelId: string,
    @Body() raw: unknown,
  ) {
    return this.voice.issueCollabToken(user.id, channelId, raw);
  }
}
