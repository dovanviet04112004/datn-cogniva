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

  @Get('recordings/:recId')
  recordingDetail(@CurrentUser() user: AuthUser, @Param('recId') recId: string) {
    return this.recordings.getRecordingDetail(user.id, recId);
  }

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

  @Get(':id/stage')
  getStageState(@CurrentUser() user: AuthUser, @Param('id') channelId: string) {
    return this.voice.getStageState(user, channelId);
  }

  @HttpCode(200)
  @Post(':id/stage')
  raiseHand(@CurrentUser() user: AuthUser, @Param('id') channelId: string, @Body() raw: unknown) {
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
