/**
 * /api/groups/* (core) — port từ route Next (apps/web/src/app/api/groups/**).
 * Mọi route cần session (guard mặc định lo 401 {error:'Unauthorized'}).
 *
 * Route static (join/upload/file/resource-search) khai báo TRƯỚC ':id' để
 * Express match đúng. Upload: FileInterceptor memory storage, limit 30MB để
 * check thủ công 25MB của route cũ vẫn chạy (message 413 giữ nguyên văn).
 * Sub-resource (:id/categories|channels|members|roles|invites) ở
 * GroupAdminController.
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
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/session.types';
import { StorageService } from '../../infra/storage/storage.service';
import { GroupsService } from './groups.service';
import {
  createGroupSchema,
  joinGroupSchema,
  type CreateGroupInput,
  type JoinGroupInput,
} from './dto/groups.dto';

const MAX_UPLOAD_SIZE = 25 * 1024 * 1024; // 25 MB (Discord free tier reference)

const ALLOWED_MIME = new Set([
  // image
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  // audio
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
  // video
  'video/mp4',
  'video/webm',
  // doc
  'application/pdf',
  'text/plain',
  'text/markdown',
  // archive
  'application/zip',
]);

function inferType(mime: string): 'image' | 'audio' | 'video' | 'file' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  zip: 'application/zip',
};

@ApiTags('groups')
@Controller('groups')
export class GroupsController {
  constructor(
    private readonly groups: GroupsService,
    private readonly storage: StorageService,
  ) {}

  /** GET /groups — sidebar list của user (kèm memberCount + myRole). */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.groups.listGroups(user.id);
  }

  /** POST /groups — tạo group (201 mặc định của Nest = status route cũ). */
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createGroupSchema)) body: CreateGroupInput,
  ) {
    return this.groups.createGroup(user.id, body);
  }

  /** POST /groups/join — join bằng invite code (route cũ trả 200). */
  @Post('join')
  @HttpCode(200)
  join(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(joinGroupSchema)) body: JoinGroupInput,
  ) {
    return this.groups.joinGroup(user, body);
  }

  /** POST /groups/upload — multipart "file" → storage key group-attachments/. */
  @Post('upload')
  @HttpCode(200)
  @UseInterceptors(
    // KHÔNG truyền storage → multer memory storage. Limit 30MB > 25MB để check
    // thủ công bên dưới giữ nguyên message 413 cũ.
    FileInterceptor('file', { limits: { fileSize: 30 * 1024 * 1024 } }),
  )
  async upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) {
      throw new BadRequestException({ error: 'Cần field "file"' });
    }
    if (file.size > MAX_UPLOAD_SIZE) {
      throw new HttpException(
        { error: `File quá lớn (>${MAX_UPLOAD_SIZE / 1024 / 1024}MB)` },
        413,
      );
    }
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new HttpException({ error: `Mime "${file.mimetype}" không hỗ trợ` }, 415);
    }

    // busboy decode filename latin1 → convert UTF-8 cho tên tiếng Việt (parity
    // với formData() của Next — xem documents.controller).
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');

    // Storage key: group-attachments/<userId>/<timestamp>-<safeName>
    const ts = Date.now();
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    const storageKey = `group-attachments/${user.id}/${ts}-${safeName}`;

    await this.storage.put(storageKey, file.buffer, file.mimetype);

    return {
      storageKey,
      url: `/api/groups/file/${encodeURIComponent(storageKey)}`,
      type: inferType(file.mimetype),
      size: file.size,
      mime: file.mimetype,
      name: originalName,
    };
  }

  /**
   * GET /groups/file/*key — serve attachment (chỉ cần login, key unguessable).
   * Express 5 trả wildcard param dạng mảng segment đã decode → join lại rồi
   * decode lần nữa (vô hại — key sanitize không chứa '%', y flashcards/image).
   * Cache 30 ngày immutable (key có timestamp, không bao giờ replace).
   */
  @Get('file/*key')
  async file(@Param('key') keyParam: string | string[], @Res() res: Response) {
    const segments = Array.isArray(keyParam) ? keyParam : [keyParam];
    const storageKey = segments.map((k) => decodeURIComponent(k)).join('/');

    // Chỉ cho phép key thuộc namespace group-attachments
    if (!storageKey.startsWith('group-attachments/')) {
      res.status(400).json({ error: 'Invalid key' });
      return;
    }

    try {
      const buf = await this.storage.get(storageKey);
      // Mime detect đơn giản theo extension
      const ext = storageKey.split('.').pop()?.toLowerCase() ?? '';
      const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
      res
        .status(200)
        .set({
          'Content-Type': mime,
          'Cache-Control': 'private, max-age=2592000, immutable',
        })
        .send(buf);
    } catch {
      res.status(404).json({ error: 'Not found' });
    }
  }

  /** GET /groups/resource-search?type=doc|flashcard|exam&q= — resource mình sở hữu. */
  @Get('resource-search')
  resourceSearch(
    @CurrentUser() user: AuthUser,
    @Query('type') type?: string,
    @Query('q') q?: string,
  ) {
    return this.groups.resourceSearch(user.id, type ?? null, q ?? null);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.groups.getGroupDetail(user.id, id);
  }

  /** PUT /groups/:id — body parse trong service (403 trước 400 y route cũ). */
  @Put(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.groups.updateGroup(user.id, id, raw);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.groups.deleteGroup(user.id, id);
  }

  /** GET /groups/:id/unread — badge per-channel của user hiện tại. */
  @Get(':id/unread')
  unread(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.groups.unread(user.id, id);
  }

  /* POST :id/ping KHÔNG port — 0 caller, đã thay bằng Socket.IO presence. */

  /** GET /groups/:id/search?q=&limit=20 — FTS + filter chip. */
  @Get(':id/search')
  search(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.groups.searchMessages(user.id, id, q ?? '', limit);
  }

  /** GET /groups/:id/audit?limit=50 — ADMIN+ xem mod actions. */
  @Get(':id/audit')
  audit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    return this.groups.getAuditLog(user.id, id, limit);
  }
}
