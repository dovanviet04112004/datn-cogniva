/**
 * TutorKycService — POST /tutors/:id/kyc, port từ
 * apps/web/src/app/api/tutors/[id]/kyc/route.ts (chỉ POST — GET không port,
 * flow admin duyệt nằm wave khác).
 *
 * Upload multipart 'file' + 'docType' + 'originalName' → R2 key
 * `kyc/{tutorId}/{uuid}.{ext}` → insert tutor_kyc_document PENDING → set
 * profile.verificationStatus = KYC_PENDING VÔ ĐIỀU KIỆN (kể cả đang
 * KYC_VERIFIED — giữ y route cũ, admin duyệt lại).
 */
import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';

import { PrismaService } from '../../../infra/database/prisma.service';
import { StorageService } from '../../../infra/storage/storage.service';

export const KYC_MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB cho ảnh CCCD / bằng cấp

const ALLOWED_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

const DOC_TYPES = ['CCCD_FRONT', 'CCCD_BACK', 'DEGREE', 'CERTIFICATE', 'OTHER'] as const;
const DOC_TYPE_SCHEMA = z.enum(DOC_TYPES);

interface KycUploadInput {
  /** Content-Type header — route cũ 400 khi body không phải multipart. */
  contentType: string;
  file: Express.Multer.File | undefined;
  docType: unknown;
  originalName: unknown;
}

@Injectable()
export class TutorKycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async uploadDocument(userId: string, tutorId: string, input: KycUploadInput) {
    const profile = await this.prisma.tutor_profile.findUnique({
      where: { id: tutorId },
      select: { user_id: true },
    });
    if (!profile) throw new NotFoundException({ error: 'Not found' });
    if (profile.user_id !== userId) {
      throw new ForbiddenException({ error: 'Chỉ chính tutor mới upload được' });
    }

    // Route cũ: request.formData() throw khi không phải multipart → 400.
    // Multer skip silent → tự check content-type giữ message cũ.
    if (!input.contentType.includes('multipart/form-data')) {
      throw new BadRequestException({ error: 'Body phải multipart/form-data' });
    }
    if (!input.file) {
      throw new BadRequestException({ error: '"file" thiếu' });
    }

    // busboy (multer) decode filename latin1 → tên tiếng Việt vỡ; Next
    // formData() decode UTF-8 — convert lại cho parity.
    const fileName = Buffer.from(input.file.originalname, 'latin1').toString('utf8');
    const docType = typeof input.docType === 'string' ? input.docType : '';
    const originalName =
      typeof input.originalName === 'string' ? input.originalName : fileName;

    const dtParsed = DOC_TYPE_SCHEMA.safeParse(docType);
    if (!dtParsed.success) {
      throw new BadRequestException({
        error: `docType phải là ${DOC_TYPES.join(' / ')}`,
      });
    }
    if (input.file.size === 0 || input.file.size > KYC_MAX_FILE_BYTES) {
      throw new BadRequestException({
        error: `File rỗng hoặc vượt ${KYC_MAX_FILE_BYTES / (1024 * 1024)} MB`,
      });
    }
    if (!ALLOWED_MIME.includes(input.file.mimetype as (typeof ALLOWED_MIME)[number])) {
      throw new BadRequestException({
        error: `MIME ${input.file.mimetype} không hỗ trợ`,
      });
    }

    const docId = randomUUID();
    const ext = input.file.mimetype === 'application/pdf' ? 'pdf'
      : input.file.mimetype === 'image/jpeg' ? 'jpg'
      : input.file.mimetype === 'image/png' ? 'png'
      : 'webp';
    const storageKey = `kyc/${tutorId}/${docId}.${ext}`;

    await this.storage.put(storageKey, input.file.buffer, input.file.mimetype);

    const created = await this.prisma.tutor_kyc_document.create({
      data: {
        id: randomUUID(),
        tutor_id: tutorId,
        doc_type: dtParsed.data,
        storage_key: storageKey,
        mime_type: input.file.mimetype,
        size_bytes: input.file.size,
        original_name: originalName,
        status: 'PENDING',
      },
    });

    // Chuyển profile sang KYC_PENDING nếu chưa
    await this.prisma.tutor_profile.update({
      where: { id: tutorId },
      data: { verification_status: 'KYC_PENDING', updated_at: new Date() },
    });

    return {
      document: {
        id: created.id,
        tutorId: created.tutor_id,
        docType: created.doc_type,
        storageKey: created.storage_key,
        mimeType: created.mime_type,
        sizeBytes: created.size_bytes,
        originalName: created.original_name,
        status: created.status,
        reviewedBy: created.reviewed_by,
        reviewNote: created.review_note,
        createdAt: created.created_at,
        reviewedAt: created.reviewed_at,
      },
    };
  }
}
