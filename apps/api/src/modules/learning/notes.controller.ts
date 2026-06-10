/**
 * /api/notes/* — port từ route Next (apps/web/src/app/api/notes/**).
 * Tất cả route đều cần session (guard mặc định lo 401 {error:'Unauthorized'}).
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
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { checkLimit } from '@cogniva/server-core/rate-limit';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/session.types';
import { NotesService } from './notes.service';
import {
  completeNoteSchema,
  createNoteSchema,
  updateNoteSchema,
  type CreateNoteInput,
  type UpdateNoteInput,
} from './dto/notes.dto';

@ApiTags('notes')
@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  /** GET /notes?limit=50&offset=0&workspaceId=X — parse query y route cũ (cap 200). */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
    @Query('workspaceId') workspaceParam?: string,
  ) {
    const limit = Math.min(Number(limitRaw ?? 50), 200);
    const offset = Math.max(Number(offsetRaw ?? 0), 0);
    return this.notes.listNotes(user.id, { limit, offset, workspaceParam: workspaceParam ?? null });
  }

  /**
   * POST /notes/complete — AI inline completion (route cũ trả 200, không 201).
   * Rate-limit chạy TRƯỚC validate body (đúng thứ tự route cũ: 429 ưu tiên hơn 400)
   * nên parse zod thủ công thay vì qua pipe.
   */
  @Post('complete')
  @HttpCode(200)
  async complete(
    @CurrentUser() user: AuthUser,
    @Body() raw: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rl = await checkLimit(`aigen:${user.id}`, 'aiGenerate');
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfter ?? 60));
      throw new HttpException({ error: 'Too many requests' }, 429);
    }

    const parsed = completeNoteSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ error: parsed.error.flatten() });

    return { completion: await this.notes.completeNote(parsed.data.prefix) };
  }

  /** POST /notes — tạo note (201 mặc định của Nest = status route cũ). */
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createNoteSchema)) body: CreateNoteInput,
  ) {
    return this.notes.createNote(user.id, body);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notes.getNote(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateNoteSchema)) body: UpdateNoteInput,
  ) {
    return this.notes.updateNote(user.id, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notes.deleteNote(user.id, id);
  }
}
