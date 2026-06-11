import { HttpException, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infra/database/prisma.service';
import { StorageService } from '../../../infra/storage/storage.service';
import { LibraryAccessService } from './access.service';

export type LibraryFilePayload = {
  buffer: Buffer;
  contentType: string;
  filename: string;
};

@Injectable()
export class LibraryFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly access: LibraryAccessService,
  ) {}

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

    const accessInfo = await this.access.checkDocAccess(id, userId);
    if (accessInfo && !accessInfo.access.allowed) {
      throw new HttpException(
        { error: 'Premium doc — cần mua trước khi xem', reason: accessInfo.access.reason },
        402,
      );
    }

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

  async getDownloadUrl(userId: string, id: string) {
    const doc = await this.prisma.library_doc.findUnique({
      where: { id },
      select: { id: true, uploader_id: true, file_url: true, status: true },
    });
    if (!doc) throw new HttpException({ error: 'Not found' }, 404);
    if (doc.status !== 'PUBLISHED' && doc.uploader_id !== userId) {
      throw new HttpException({ error: 'Not available' }, 403);
    }

    const accessInfo = await this.access.checkDocAccess(id, userId);
    if (accessInfo && !accessInfo.access.allowed) {
      throw new HttpException(
        { error: 'Premium doc — cần mua trước khi tải về', reason: accessInfo.access.reason },
        402,
      );
    }

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

    void this.prisma.library_doc
      .update({ where: { id }, data: { download_count: { increment: 1 } } })
      .catch(() => {});

    return { url: signedUrl };
  }
}
