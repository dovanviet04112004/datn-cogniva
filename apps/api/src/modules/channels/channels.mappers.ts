import { Prisma } from '@prisma/client';
import type { study_group_message as MessageRow } from '@prisma/client';

export function jsonOrDbNull(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue);
}

export function toMessageRowDto(row: MessageRow) {
  return {
    id: row.id,
    channelId: row.channel_id,
    authorId: row.author_id,
    content: row.content,
    contentType: row.content_type,
    replyToId: row.reply_to_id,
    attachments: row.attachments,
    reactions: row.reactions,
    pinned: row.pinned,
    mentions: row.mentions,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    threadRootId: row.thread_root_id,
    threadCount: row.thread_count,
    threadLastAt: row.thread_last_at,
    title: row.title,
    tags: row.tags,
    isSolution: row.is_solution,
    archivedAt: row.archived_at,
  };
}
