import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type note as NoteRow } from '@prisma/client';
import { onWorkspaceContentChanged } from '@cogniva/server-core/cache/invalidate';

import { LlmService } from '../../infra/ai/llm.service';
import { PrismaService } from '../../infra/database/prisma.service';
import { XP_AMOUNTS, XpService } from '../gamification/xp.service';
import type { CreateNoteInput, UpdateNoteInput } from './dto/notes.dto';

interface NoteDto {
  id: string;
  userId: string;
  workspaceId: string | null;
  title: string;
  content: string;
  conceptId: string | null;
  documentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const INSTRUCTION = `Bạn là trợ lý viết note. Đoạn dưới là text mà người dùng đã viết. Hãy tiếp tục mạch văn bằng 1-2 câu NGẮN GỌN, đúng phong cách họ đang dùng.

QUY TẮC:
- Tiếp tục TRỰC TIẾP (không có dấu "..." đầu, không lặp câu trước).
- 1-2 câu, ≤ 40 từ.
- Cùng ngôn ngữ với đoạn văn (nếu họ viết tiếng Việt, trả tiếng Việt).
- Không thêm metadata/comment/markdown — chỉ text thuần.

ĐOẠN VĂN ĐÃ VIẾT:
"""
{{PREFIX}}
"""

TIẾP TỤC:`;

@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly xp: XpService,
  ) {}

  private toNoteDto(row: NoteRow): NoteDto {
    return {
      id: row.id,
      userId: row.user_id,
      workspaceId: row.workspace_id,
      title: row.title,
      content: row.content,
      conceptId: row.concept_id,
      documentId: row.document_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async listNotes(
    userId: string,
    opts: { limit: number; offset: number; workspaceParam: string | null },
  ) {
    const where: Prisma.noteWhereInput = { user_id: userId };
    if (opts.workspaceParam === 'null') where.workspace_id = null;
    else if (opts.workspaceParam) where.workspace_id = opts.workspaceParam;

    const rows = await this.prisma.note.findMany({
      where,
      orderBy: { updated_at: 'desc' },
      take: opts.limit,
      skip: opts.offset,
      select: {
        id: true,
        title: true,
        content: true,
        workspace_id: true,
        concept_id: true,
        document_id: true,
        created_at: true,
        updated_at: true,
      },
    });

    return {
      notes: rows.map((r) => ({
        id: r.id,
        title: r.title,
        content: r.content,
        workspaceId: r.workspace_id,
        conceptId: r.concept_id,
        documentId: r.document_id,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    };
  }

  async createNote(userId: string, input: CreateNoteInput) {
    const inserted = await this.prisma.note.create({
      data: {
        id: randomUUID(),
        user_id: userId,
        workspace_id: input.workspaceId ?? null,
        title: input.title,
        content: input.content,
        concept_id: input.conceptId ?? null,
        document_id: input.documentId ?? null,
      },
    });

    await this.xp.awardXp(userId, XP_AMOUNTS.NOTE_CREATE, { source: 'note', totalCount: 1 });

    if (inserted.workspace_id) {
      await onWorkspaceContentChanged(userId, inserted.workspace_id);
    }

    return { note: this.toNoteDto(inserted) };
  }

  async getNote(userId: string, id: string) {
    const row = await this.prisma.note.findFirst({ where: { id, user_id: userId } });
    if (!row) throw new NotFoundException({ error: 'Not found' });
    return { note: this.toNoteDto(row) };
  }

  async updateNote(userId: string, id: string, input: UpdateNoteInput) {
    const existing = await this.prisma.note.findFirst({ where: { id, user_id: userId } });
    if (!existing) throw new NotFoundException({ error: 'Not found' });

    const updated = await this.prisma.note.update({
      where: { id },
      data: {
        title: input.title ?? existing.title,
        content: input.content ?? existing.content,
        updated_at: new Date(),
      },
    });
    return { note: this.toNoteDto(updated) };
  }

  async deleteNote(userId: string, id: string) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; workspace_id: string | null }>>(
      Prisma.sql`DELETE FROM note WHERE id = ${id} AND user_id = ${userId} RETURNING id, workspace_id`,
    );
    if (rows.length === 0) throw new NotFoundException({ error: 'Not found' });

    const deletedWorkspaceId = rows[0]?.workspace_id;
    if (deletedWorkspaceId) {
      await onWorkspaceContentChanged(userId, deletedWorkspaceId);
    }
    return { deleted: true };
  }

  async completeNote(prefix: string): Promise<string> {
    const trimmed = prefix.trim();
    if (trimmed.length < 20) return '';

    const cap = trimmed.length > 500 ? trimmed.slice(-500) : trimmed;

    try {
      const text = await this.llm.complete(INSTRUCTION.replace('{{PREFIX}}', cap), {
        temperature: 0.6,
        maxTokens: 120,
      });
      return text.trim().replace(/^["']|["']$/g, '');
    } catch (err) {
      console.warn('[note-complete] fail:', (err as Error).message);
      return '';
    }
  }
}
