/**
 * /api/tutors/* — port từ route Next (apps/web/src/app/api/tutors/**), CHỈ
 * các mutation của become-tutor wizard (Wave 7). Mọi route cần session
 * (guard mặc định lo 401 {error:'Unauthorized'}).
 *
 * Body KHÔNG qua pipe: route cũ check existing-profile/ownership TRƯỚC khi
 * parse body (pipe sẽ đảo thứ tự status) — service tự safeParse.
 */
import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  Param,
  Post,
  Put,
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

  /** POST /tutors — tạo draft profile; đã có → 200 {reused:true}, mới → 201. */
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

  /** PUT /tutors/:id/availability — bulk replace lịch rảnh. */
  @Put(':id/availability')
  replaceAvailability(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.tutors.replaceAvailability(user.id, id, body);
  }

  /** POST /tutors/:id/favorite — toggle favorite (route cũ trả 200). */
  @Post(':id/favorite')
  @HttpCode(200)
  toggleFavorite(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tutors.toggleFavorite(user.id, id);
  }

  /**
   * POST /tutors/:id/kyc — upload KYC doc (201). Thứ tự check giữ y route cũ:
   * rate-limit → 404/403 → multipart/file/docType/size/mime trong service.
   * Multer limit 11MB > check 10MB thủ công để message 400 cũ vẫn chạy.
   */
  @Post(':id/kyc')
  @UseInterceptors(
    // KHÔNG truyền storage → multer default memory storage (file.buffer).
    FileInterceptor('file', { limits: { fileSize: 11 * 1024 * 1024 } }),
  )
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

  /** POST /tutors/:id/publish — DRAFT → PUBLISHED (route cũ trả 200). */
  @Post(':id/publish')
  @HttpCode(200)
  publish(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tutors.publish(user.id, id);
  }

  /** POST /tutors/:id/subjects — thêm môn dạy (201; dup → 409). */
  @Post(':id/subjects')
  addSubject(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.tutors.addSubject(user.id, id, body);
  }

  /** POST /tutors/:id/subjects/:sid/verify-quiz — AI gen quiz verify môn (201). */
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
