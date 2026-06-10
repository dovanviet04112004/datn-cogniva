/**
 * /api/flashcards/* — port từ route Next (apps/web/src/app/api/flashcards/**).
 * Tất cả route đều cần session (guard mặc định lo 401 {error:'Unauthorized'}).
 * Route tĩnh (queue/stats/generate/upload-image/image) khai TRƯỚC ':id' để
 * Express không nuốt nhầm vào param.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { checkLimit } from '@cogniva/server-core/rate-limit';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/session.types';
import type { Plan } from '../../infra/ai/cost-guardrail.service';
import { FlashcardsService, type UploadedImageFile } from './flashcards.service';
import {
  createFlashcardSchema,
  generateFlashcardsSchema,
  reviewFlashcardSchema,
  type CreateFlashcardInput,
  type ReviewFlashcardInput,
} from './dto/flashcards.dto';

@ApiTags('flashcards')
@Controller('flashcards')
export class FlashcardsController {
  constructor(private readonly flashcards: FlashcardsService) {}

  /** GET /flashcards?state=&workspaceId=&limit=50&offset=0 — parse y route cũ (cap 200). */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('state') state?: string,
    @Query('workspaceId') workspaceParam?: string,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ) {
    const limit = Math.min(Number(limitRaw ?? 50), 200);
    const offset = Math.max(Number(offsetRaw ?? 0), 0);
    return this.flashcards.list(user.id, {
      state: state ?? null,
      workspaceParam: workspaceParam ?? null,
      limit,
      offset,
    });
  }

  /** GET /flashcards/queue?limit=20&workspaceId= — daily review queue (cap 100). */
  @Get('queue')
  queue(
    @CurrentUser() user: AuthUser,
    @Query('limit') limitRaw?: string,
    @Query('workspaceId') workspaceId?: string,
  ) {
    const limit = Math.min(Number(limitRaw ?? 20), 100);
    return this.flashcards.queue(user.id, limit, workspaceId ?? null);
  }

  /** GET /flashcards/stats — số liệu tổng quan cho dashboard. */
  @Get('stats')
  stats(@CurrentUser() user: AuthUser) {
    return this.flashcards.stats(user.id);
  }

  /** POST /flashcards — tạo card thủ công (201 mặc định của Nest = status route cũ). */
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createFlashcardSchema)) body: CreateFlashcardInput,
  ) {
    return this.flashcards.create(user.id, body);
  }

  /**
   * POST /flashcards/generate — AI sinh cards (route cũ trả 200, không 201).
   * Rate-limit chạy TRƯỚC validate body (429 ưu tiên hơn 400 như route cũ)
   * nên parse zod thủ công thay vì qua pipe.
   */
  @Post('generate')
  @HttpCode(200)
  async generate(
    @CurrentUser() user: AuthUser,
    @Body() raw: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rl = await checkLimit(`aigen:${user.id}`, 'aiGenerate');
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfter ?? 60));
      throw new HttpException({ error: 'Too many requests' }, 429);
    }

    const parsed = generateFlashcardsSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ error: parsed.error.flatten() });
    const { documentId, conceptId, chunkIds } = parsed.data;
    if (!documentId && !conceptId && (!chunkIds || chunkIds.length === 0)) {
      throw new BadRequestException({ error: 'Cần cung cấp documentId, conceptId hoặc chunkIds' });
    }

    const plan = (user.plan ?? 'FREE') as Plan;
    return this.flashcards.generate(user.id, plan, parsed.data);
  }

  /** POST /flashcards/upload-image — multipart field "file" (route cũ trả 200). */
  @Post('upload-image')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  uploadImage(@CurrentUser() user: AuthUser, @UploadedFile() file?: UploadedImageFile) {
    return this.flashcards.uploadImage(user.id, file);
  }

  /**
   * GET /flashcards/image/*key — stream ảnh card từ storage. Catch-all giữ '/'
   * trong storage key; Express 5 trả wildcard param dạng mảng segment → join
   * lại rồi decode (double-decode vô hại — key đã sanitize không chứa '%').
   * Chỉ check session, KHÔNG verify ownership (ảnh public-ish trong scope user
   * đã login — như route cũ). 404 trả text thuần y Response cũ.
   */
  @Get('image/*key')
  async image(@Param('key') keyParam: string | string[], @Res() res: Response) {
    const segments = Array.isArray(keyParam) ? keyParam : [keyParam];
    const storageKey = decodeURIComponent(segments.join('/'));

    try {
      const buffer = await this.flashcards.readImage(storageKey);
      // Inferred MIME từ extension — đủ cho 3 type cho phép upload.
      const ext = storageKey.split('.').pop()?.toLowerCase();
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      res
        .status(200)
        .set({
          'Content-Type': mime,
          'Content-Length': buffer.byteLength.toString(),
          'Cache-Control': 'private, max-age=3600',
        })
        .send(buffer);
    } catch (err) {
      console.error('[image] storage read failed:', err);
      res.status(404).set('Content-Type', 'text/plain;charset=UTF-8').send('Not found');
    }
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.flashcards.get(user.id, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.flashcards.remove(user.id, id);
  }

  /** POST /flashcards/:id/review — submit rating 1-4 (route cũ trả 200). */
  @Post(':id/review')
  @HttpCode(200)
  review(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reviewFlashcardSchema)) body: ReviewFlashcardInput,
  ) {
    return this.flashcards.review(user.id, id, body);
  }
}
