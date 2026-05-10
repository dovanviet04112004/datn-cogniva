/**
 * GET /api/graph/concept/[id] — chi tiết 1 concept + chunks liên quan.
 *
 * Dùng cho ConceptPanel khi user click node graph: show description, list
 * chunks (ngắn, 3-10 cái), kèm tên file gốc + page để click sang document.
 *
 * Bảo mật: scope qua user — chỉ trả chunks thuộc tài liệu của user (chống
 * IDOR khi user A click concept và xem chunks của user B).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { concept, db, sql } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const [conceptRow] = await db.select().from(concept).where(eq(concept.id, id)).limit(1);
  if (!conceptRow) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Lấy chunks của user link tới concept này — limit 10 để panel gọn
  const chunks = await db.execute<{
    id: string;
    content: string;
    document_id: string;
    filename: string;
    page: number | null;
    strength: number;
  }>(sql`
    SELECT
      c.id,
      c.content,
      c.document_id,
      d.filename,
      (c.metadata->>'page')::int AS page,
      cc.strength
    FROM chunk_concept cc
    INNER JOIN chunk c ON c.id = cc.chunk_id
    INNER JOIN document d ON d.id = c.document_id
    WHERE cc.concept_id = ${id}
      AND d.user_id = ${session.user.id}
    ORDER BY cc.strength DESC, c.id
    LIMIT 10;
  `);

  return NextResponse.json({
    concept: {
      id: conceptRow.id,
      name: conceptRow.name,
      description: conceptRow.description,
      domain: conceptRow.domain,
    },
    chunks: chunks.map((c) => ({
      id: c.id,
      // Truncate content ~200 chars cho panel — full chunk có ở document viewer
      snippet: c.content.length > 220 ? c.content.slice(0, 220) + '…' : c.content,
      documentId: c.document_id,
      filename: c.filename,
      page: c.page,
      strength: Number(c.strength),
    })),
  });
}
