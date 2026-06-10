/**
 * /api/library/* — nhóm CONTENT (upload 2 bước, import workspace, file/download),
 * port từ apps/web/src/app/api/library/** (xem từng service).
 *
 * Mọi POST route cũ trả 200 (NextResponse.json default) → @HttpCode(200).
 * Body safeParse trong service để giữ shape lỗi `{error:'Invalid body', details}`.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/auth/session.types';
import { LibraryFilesService } from './library-files.service';
import { LibraryImportService } from './library-import.service';
import { LibraryUploadService } from './library-upload.service';

@ApiTags('library')
@Controller('library')
export class LibraryContentController {
  constructor(
    private readonly upload: LibraryUploadService,
    private readonly importer: LibraryImportService,
    private readonly files: LibraryFilesService,
  ) {}

  /** POST docs/upload-init — presigned PUT R2 + reserve doc record (dedup hash 409). */
  @HttpCode(200)
  @Post('docs/upload-init')
  uploadInit(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    return this.upload.uploadInit(user.id, raw);
  }

  /** POST docs/finalize — metadata đầy đủ + trigger ingest pipeline async. */
  @HttpCode(200)
  @Post('docs/finalize')
  finalize(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    return this.upload.finalize(user.id, raw);
  }

  /** POST docs/:id/import — clone vào workspace (402 premium / 429 rate limit). */
  @HttpCode(200)
  @Post('docs/:id/import')
  importDoc(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.importer.importDoc(user.id, id, raw);
  }

  /** POST import-batch — bulk import ≤10 docs (skip duplicates idempotent). */
  @HttpCode(200)
  @Post('import-batch')
  importBatch(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    return this.importer.importBatch(user, raw);
  }

  /**
   * GET docs/:id/file — proxy R2 stream (PDF.js fetch qua server tránh CORS).
   * Nội dung bất biến (storageKey theo docId) → cache 24h + immutable.
   */
  @Get('docs/:id/file')
  async file(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const out = await this.files.getFile(user.id, id);
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    return new StreamableFile(out.buffer, {
      type: out.contentType,
      length: out.buffer.length,
      disposition: `inline; filename="${out.filename}"`,
    });
  }

  /** GET docs/:id/download — presigned URL 1h + download_count++ (remix → demo). */
  @Get('docs/:id/download')
  download(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.files.getDownloadUrl(user.id, id);
  }
}
