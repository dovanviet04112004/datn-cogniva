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

const MAX_UPLOAD_SIZE = 25 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
  'video/mp4',
  'video/webm',
  'application/pdf',
  'text/plain',
  'text/markdown',
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

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.groups.listGroups(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createGroupSchema)) body: CreateGroupInput,
  ) {
    return this.groups.createGroup(user.id, body);
  }

  @Post('join')
  @HttpCode(200)
  join(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(joinGroupSchema)) body: JoinGroupInput,
  ) {
    return this.groups.joinGroup(user, body);
  }

  @Post('upload')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 30 * 1024 * 1024 } }))
  async upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) {
      throw new BadRequestException({ error: 'Cần field "file"' });
    }
    if (file.size > MAX_UPLOAD_SIZE) {
      throw new HttpException({ error: `File quá lớn (>${MAX_UPLOAD_SIZE / 1024 / 1024}MB)` }, 413);
    }
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new HttpException({ error: `Mime "${file.mimetype}" không hỗ trợ` }, 415);
    }

    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');

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

  @Get('file/*key')
  async file(@Param('key') keyParam: string | string[], @Res() res: Response) {
    const segments = Array.isArray(keyParam) ? keyParam : [keyParam];
    const storageKey = segments.map((k) => decodeURIComponent(k)).join('/');

    if (!storageKey.startsWith('group-attachments/')) {
      res.status(400).json({ error: 'Invalid key' });
      return;
    }

    try {
      const buf = await this.storage.get(storageKey);
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

  @Get('latest')
  latest(@CurrentUser() user: AuthUser) {
    return this.groups.latestJoinedGroup(user.id);
  }

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

  @Put(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.groups.updateGroup(user.id, id, raw);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.groups.deleteGroup(user.id, id);
  }

  @Get(':id/shell')
  shell(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.groups.getShell(user.id, id);
  }

  @Get(':id/first-channel')
  firstChannel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.groups.firstChannel(user.id, id);
  }

  @Get(':id/member-role')
  memberRole(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.groups.memberRole(user.id, id);
  }

  @Get(':id/unread')
  unread(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.groups.unread(user.id, id);
  }

  @Get(':id/search')
  search(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.groups.searchMessages(user.id, id, q ?? '', limit);
  }

  @Get(':id/audit')
  audit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('limit') limit?: string) {
    return this.groups.getAuditLog(user.id, id, limit);
  }
}
