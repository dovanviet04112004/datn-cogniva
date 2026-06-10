/**
 * LibraryFilesService — file proxy + signed download, port từ:
 *   GET /api/library/docs/[id]/file      (proxy R2 stream — PDF.js tránh CORS)
 *   GET /api/library/docs/[id]/download  (presigned URL 1h + download_count++)
 * (apps/web/src/app/api/library/docs/[id]/{file,download}/route.ts)
 *
 * Cả 2 route gate premium qua LibraryAccessService (402 y route cũ).
 */
import { HttpException, Injectable } from '@nestjs/common';

import { PrismaService } from '../../infra/database/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { LibraryAccessService } from './library-access.service';

export type LibraryFilePayload = {
  buffer: Buffer;
  contentType: string;
  /** Content-Disposition inline filename y route cũ: `${id}.${ext}`. */
  filename: string;
};

@Injectable()
export class LibraryFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly access: LibraryAccessService,
  ) {}

  /** GET docs/:id/file — trả buffer + headers info (controller stream). */
  async getFile(userId: string, id: string): Promise<LibraryFilePayload> {
    const doc = await this.prisma.library_doc.findUnique({
      where: { id },
      select: {
        id: true,
        file_url: true,
        file_format: true,
        status: true,
        uploader_id: true,
      },
    });
    if (!doc) throw new HttpException({ error: 'Not found' }, 404);
    if (doc.status !== 'PUBLISHED' && doc.uploader_id !== userId) {
      throw new HttpException({ error: 'Not available' }, 403);
    }

    // Gate premium content
    const accessInfo = await this.access.checkDocAccess(id, userId);
    if (accessInfo && !accessInfo.access.allowed) {
      throw new HttpException(
        { error: 'Premium doc — cần mua trước khi xem', reason: accessInfo.access.reason },
        402,
      );
    }

    // Reject demo seed / remix placeholders
    if (doc.file_url.startsWith('seed-') || doc.file_url.startsWith('remix://')) {
      throw new HttpException({ error: 'No file content' }, 404);
    }

    const match = doc.file_url.match(/\/(lib\/[^/]+\/[^/?]+)/);
    if (!match || !match[1]) {
      throw new HttpException({ error: 'Invalid storage key' }, 500);
    }
    const storageKey = match[1];

    try {
      const buffer = await this.storage.get(storageKey);
      const contentType =
        doc.file_format === 'pdf'
          ? 'application/pdf'
          : doc.file_format === 'docx'
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : 'image/png';
      return {
        buffer,
        contentType,
        filename: `${id}.${doc.file_format === 'image' ? 'png' : doc.file_format}`,
      };
    } catch (err) {
      throw new HttpException({ error: `R2 fetch fail: ${(err as Error).message}` }, 500);
    }
  }

  /** GET docs/:id/download — presigned URL (1h) + counter fire-and-forget. */
  async getDownloadUrl(userId: string, id: string) {
    const doc = await this.prisma.library_doc.findUnique({
      where: { id },
      select: { id: true, uploader_id: true, file_url: true, status: true },
    });
    if (!doc) throw new HttpException({ error: 'Not found' }, 404);
    if (doc.status !== 'PUBLISHED' && doc.uploader_id !== userId) {
      throw new HttpException({ error: 'Not available' }, 403);
    }

    // Gate premium (cùng rule với /file + /import)
    const accessInfo = await this.access.checkDocAccess(id, userId);
    if (accessInfo && !accessInfo.access.allowed) {
      throw new HttpException(
        { error: 'Premium doc — cần mua trước khi tải về', reason: accessInfo.access.reason },
        402,
      );
    }

    // Seed doc detection — remix:// hoặc seed-* placeholder → trả demo 200.
    if (doc.file_url.startsWith('seed-') || doc.file_url.startsWith('remix://')) {
      return {
        demo: true,
        message:
          'Doc tổng hợp — content kế thừa từ source docs, xem preview các nguồn gốc bên dưới.',
      };
    }

    const match = doc.file_url.match(/\/(lib\/[^/]+\/[^/?]+)/);
    if (!match || !match[1]) {
      throw new HttpException({ error: 'Invalid file URL' }, 500);
    }
    const storageKey = match[1];
    const signedUrl = await this.storage.getPresignedDownloadUrl(storageKey, 3600);

    // Increment counter fire-and-forget
    void this.prisma.library_doc
      .update({ where: { id }, data: { download_count: { increment: 1 } } })
      .catch(() => {});

    return { url: signedUrl };
  }
}
