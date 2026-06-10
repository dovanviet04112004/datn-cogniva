/**
 * /api/documents/* — port từ route Next (apps/web/src/app/api/documents/**).
 * Tất cả route đều cần session (guard mặc định lo 401 {error:'Unauthorized'}).
 *
 * Upload: FileInterceptor memory storage, limits.fileSize 52MB để check thủ
 * công 50MB của route cũ vẫn chạy (message 400 giữ nguyên văn); status động
 * 200/207 qua passthrough res (Nest set default TRƯỚC handler nên res.status()
 * trong handler thắng).
 *
 * File proxy: route cũ trả lỗi PLAIN TEXT (không JSON) → handler tự set
 * status + trả string qua passthrough thay vì throw (filter sẽ bọc JSON).
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
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { checkLimit } from '@cogniva/server-core/rate-limit';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/session.types';
import { StorageService } from '../../infra/storage/storage.service';
import { DocumentsService } from './documents.service';
import { moveDocumentSchema, type MoveDocumentInput } from './dto/documents.dto';

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB — chặn upload PDF khổng lồ
const ALLOWED_MIME = ['application/pdf'] as const;

@ApiTags('documents')
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly storage: StorageService,
  ) {}

  /** GET /documents — list tài liệu của user (limit cứng 100, mới nhất trước). */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.documents.listDocuments(user.id);
  }

  /**
   * POST /documents/upload — multipart PDF, ingest ĐỒNG BỘ.
   * Thứ tự check giữ y route cũ: rate-limit → multipart → file → size → mime
   * → workspaceId (riêng multer parse multipart TRƯỚC handler — chấp nhận).
   */
  @Post('upload')
  @HttpCode(200)
  @UseInterceptors(
    // KHÔNG truyền storage → multer default memory storage (file.buffer).
    FileInterceptor('file', { limits: { fileSize: 52 * 1024 * 1024 } }),
  )
  async upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rl = await checkLimit(`upload:${user.id}`, 'upload');
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfter ?? 60));
      throw new HttpException({ error: 'Too many uploads' }, 429);
    }

    // Route cũ: request.formData() throw khi body không phải multipart → 400.
    // Multer chỉ skip silent → tự check content-type để giữ message cũ.
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.includes('multipart/form-data')) {
      throw new BadRequestException({ error: 'Body không phải multipart/form-data' });
    }

    if (!file) {
      throw new BadRequestException({ error: 'Field "file" thiếu hoặc không phải file' });
    }

    // busboy (multer) decode filename theo latin1 → tên file tiếng Việt vỡ;
    // Next formData() decode UTF-8 đúng — convert lại cho parity. Tên ASCII
    // thuần đi qua conversion không đổi.
    const filename = Buffer.from(file.originalname, 'latin1').toString('utf8');

    // workspaceId BẮT BUỘC — user chọn workspace để upload doc vào ĐÚNG chỗ.
    let requestedWorkspaceId: string | null = null;
    const wsField = body?.workspaceId;
    if (typeof wsField === 'string' && wsField.trim().length > 0) {
      requestedWorkspaceId = wsField.trim();
    }

    if (file.size === 0) {
      throw new BadRequestException({ error: 'File rỗng' });
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new BadRequestException({
        error: `File vượt giới hạn ${MAX_FILE_BYTES / (1024 * 1024)} MB`,
      });
    }
    if (!ALLOWED_MIME.includes(file.mimetype as (typeof ALLOWED_MIME)[number])) {
      throw new BadRequestException({
        error: `MIME type không hỗ trợ: ${file.mimetype || 'unknown'}. Phase 1 chỉ nhận PDF.`,
      });
    }
    if (!requestedWorkspaceId) {
      throw new BadRequestException({ error: 'Hãy chọn workspace để upload tài liệu vào' });
    }

    const result = await this.documents.uploadDocument(user.id, {
      buffer: file.buffer,
      size: file.size,
      mimeType: file.mimetype,
      filename,
      workspaceId: requestedWorkspaceId,
    });
    res.status(result.httpStatus);
    return result.body;
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.documents.deleteDocument(user.id, id);
  }

  /** GET /documents/:id/chunks — chunk list cho DocPreviewPanel (sort chunkIndex). */
  @Get(':id/chunks')
  chunks(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.documents.listChunks(user.id, id);
  }

  /**
   * GET /documents/:id/file — stream PDF gốc. Headers + body lỗi (plain text)
   * giữ y route cũ; chỉ 401 từ guard là JSON {error} (route cũ trả text —
   * không tái tạo được vì KHÔNG tự viết auth, xem notes).
   */
  @Get(':id/file')
  async file(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | string> {
    const doc = await this.documents.getDocumentForFile(id);

    if (!doc) {
      console.warn('[api/documents/file] doc not in DB', {
        reqDocId: id,
        sessionUserId: user.id,
      });
      res.status(404).type('text/plain');
      return 'Document not found';
    }
    if (doc.user_id !== user.id) {
      console.warn('[api/documents/file] ownership mismatch', {
        reqDocId: id,
        sessionUserId: user.id,
        docOwnerId: doc.user_id,
      });
      res.status(403).type('text/plain');
      return 'Forbidden — document belongs to another user';
    }

    try {
      const buffer = await this.storage.get(doc.storage_key);
      // Nội dung PDF BẤT BIẾN (storageKey = docId) → browser cache 24h +
      // immutable; private vì doc per-user (y route cũ).
      res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
      return new StreamableFile(buffer, {
        type: doc.mime_type,
        length: buffer.byteLength,
        disposition: `inline; filename="${encodeURIComponent(doc.filename)}"`,
      });
    } catch (err) {
      console.error('[api/documents/[id]/file] storage read failed:', err);
      res.status(404).type('text/plain');
      return 'File not found in storage';
    }
  }

  /** POST /documents/:id/move — route cũ trả 200 (Nest POST mặc định 201 → ép lại). */
  @Post(':id/move')
  @HttpCode(200)
  move(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(moveDocumentSchema)) body: MoveDocumentInput,
  ) {
    return this.documents.moveDocument(user.id, id, body.workspaceId);
  }
}
