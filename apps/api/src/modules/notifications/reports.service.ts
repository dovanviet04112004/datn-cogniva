/**
 * ReportsService — user report nội dung vi phạm. Port từ
 * apps/web/src/app/api/reports/route.ts — GIỮ NGUYÊN wire shape + THỨ TỰ check:
 * self-target 400 → target tồn tại 404 → dedupe 24h 409 → tạo 201.
 */
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../infra/database/prisma.service';
import type { CreateReportInput, ReportTargetType } from './dto/notifications.dto';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async createReport(reporterId: string, input: CreateReportInput) {
    const { targetType, targetId, reason } = input;

    // Self-target protection
    if (targetType === 'user' && targetId === reporterId) {
      throw new BadRequestException({ error: 'Không thể report chính mình' });
    }

    const exists = await this.targetExists(targetType, targetId);
    if (!exists) {
      throw new NotFoundException({ error: `Target ${targetType}:${targetId} không tồn tại` });
    }

    // Dedupe: 1 reporter chỉ report 1 (targetType, targetId) trong 24h — chặn spam.
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const duplicate = await this.prisma.content_report.findFirst({
      where: {
        reporter_id: reporterId,
        target_type: targetType,
        target_id: targetId,
        created_at: { gt: cutoff },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException({
        error: 'Bạn đã báo cáo nội dung này trong 24h qua',
        existingId: duplicate.id,
      });
    }

    const created = await this.prisma.content_report.create({
      data: {
        // id sinh app-side (Drizzle cũ $defaultFn cuid2 — DB không có default).
        id: randomUUID(),
        reporter_id: reporterId,
        target_type: targetType,
        target_id: targetId,
        reason,
        status: 'PENDING',
      },
      select: { id: true },
    });

    return { id: created.id, status: 'PENDING' };
  }

  /**
   * Check target tồn tại — tránh garbage report. Route cũ cast 1 lookup chung
   * qua Drizzle; Prisma delegate khác type nhau nên switch tường minh 6 nhánh.
   */
  private async targetExists(type: ReportTargetType, id: string): Promise<boolean> {
    const sel = { where: { id }, select: { id: true as const } };
    switch (type) {
      case 'group_message':
        return !!(await this.prisma.study_group_message.findUnique(sel));
      case 'ai_message':
        return !!(await this.prisma.message.findUnique(sel));
      case 'user':
        return !!(await this.prisma.user.findUnique(sel));
      case 'document':
        return !!(await this.prisma.document.findUnique(sel));
      case 'group':
        return !!(await this.prisma.study_group.findUnique(sel));
      case 'conversation':
        return !!(await this.prisma.conversation.findUnique(sel));
      default:
        return false;
    }
  }
}
