import { Body, Controller, Get, HttpCode, Param, Post, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../../common/auth/session.types';
import { LibraryFilesService } from './files.service';
import { LibraryImportService } from './import.service';
import { LibraryUploadService } from './upload.service';

@ApiTags('library')
@Controller('library')
export class LibraryContentController {
  constructor(
    private readonly upload: LibraryUploadService,
    private readonly importer: LibraryImportService,
    private readonly files: LibraryFilesService,
  ) {}

  @HttpCode(200)
  @Post('docs/upload-init')
  uploadInit(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    return this.upload.uploadInit(user.id, raw);
  }

  @HttpCode(200)
  @Post('docs/finalize')
  finalize(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    return this.upload.finalize(user.id, raw);
  }

  @HttpCode(200)
  @Post('docs/:id/import')
  importDoc(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.importer.importDoc(user.id, id, raw);
  }

  @HttpCode(200)
  @Post('import-batch')
  importBatch(@CurrentUser() user: AuthUser, @Body() raw: unknown) {
    return this.importer.importBatch(user, raw);
  }

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

  @Get('docs/:id/download')
  download(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.files.getDownloadUrl(user.id, id);
  }
}
