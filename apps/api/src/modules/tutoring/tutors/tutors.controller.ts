import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { checkLimit } from '@cogniva/server-core/rate-limit';

import type { AuthUser } from '../../../common/auth/session.types';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { TutorKycService } from './kyc.service';
import { TutorsService } from './tutors.service';
import { TutorVerifyQuizService } from './verify-quiz.service';

@ApiTags('tutors')
@Controller('tutors')
export class TutorsController {
  constructor(
    private readonly tutors: TutorsService,
    private readonly kyc: TutorKycService,
    private readonly verifyQuiz: TutorVerifyQuizService,
  ) {}

  @Get()
  browse(
    @Query('subject') subject?: string,
    @Query('level') level?: string,
    @Query('modality') modality?: string,
    @Query('minRate') minRate?: string,
    @Query('maxRate') maxRate?: string,
    @Query('sort') sort?: string,
    @Query('page') page?: string,
    @Query('per') per?: string,
  ) {
    return this.tutors.browse({ subject, level, modality, minRate, maxRate, sort, page, per });
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tutors.getDetail(user.id, id);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.tutors.createProfile(user.id, body);
    res.status(result.httpStatus);
    return result.body;
  }

  @Put(':id/availability')
  replaceAvailability(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.tutors.replaceAvailability(user.id, id, body);
  }

  @Post(':id/favorite')
  @HttpCode(200)
  toggleFavorite(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tutors.toggleFavorite(user.id, id);
  }

  @Post(':id/kyc')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 11 * 1024 * 1024 } }))
  async uploadKyc(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, unknown> | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rl = await checkLimit(`kyc:${user.id}`, 'upload');
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfter ?? 60));
      throw new HttpException({ error: 'Upload quá nhiều — đợi vài phút' }, 429);
    }

    return this.kyc.uploadDocument(user.id, id, {
      contentType: req.headers['content-type'] ?? '',
      file,
      docType: body?.docType,
      originalName: body?.originalName,
    });
  }

  @Post(':id/publish')
  @HttpCode(200)
  publish(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tutors.publish(user.id, id);
  }

  @Post(':id/subjects')
  addSubject(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.tutors.addSubject(user.id, id, body);
  }

  @Post(':id/subjects/:sid/verify-quiz')
  async createVerifyQuiz(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('sid') sid: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rl = await checkLimit(`verify-quiz:${user.id}`, 'aiGenerate');
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfter ?? 60));
      throw new HttpException({ error: 'AI generation rate limit' }, 429);
    }

    return this.verifyQuiz.createVerifyQuiz(user, id, sid);
  }
}
