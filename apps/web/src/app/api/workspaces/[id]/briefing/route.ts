/**
 * GET /api/workspaces/[id]/briefing — LLM tóm tắt 200-300 từ về workspace.
 *
 * Phase V5.3 (atom-centric). Spec: docs/plans/v5-notebooklm-layout.md §5.4.
 *
 * Khác /atom-guide:
 *   - Briefing focus document content (representative chunks), không tập
 *     trung atom. Như "executive summary" để onboarding nhanh user mới về
 *     workspace.
 *   - Ngắn hơn (200-300 từ vs 500-800)
 *
 * Logic:
 *   1. Verify workspace thuộc user
 *   2. Load 5-8 chunk đầu tiên của mỗi document trong workspace (limit ~25 chunks tổng)
 *   3. Call LLM gen markdown briefing
 *   4. Cache in-memory 24h key=(workspaceId, userId)
 *
 * Force regenerate qua query `?regenerate=1`.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import {
  chunk,
  db,
  document,
  workspace,
  workspaceCachedOutput,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { routedGenerateText } from '@/lib/ai/router';
import type { Plan } from '@/lib/observability/cost-guardrail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CHUNKS_TOTAL = 25;
const CHUNKS_PER_DOC = 5;

// V6: persistent cache via workspace_cached_output table (migration 0035)
// thay in-memory Map — survive server restart.

const SYSTEM_PROMPT = `Bạn là tutor onboarding học sinh vào workspace mới. Đọc nội dung sources dưới đây và viết briefing 200-300 từ tóm tắt workspace, để học sinh hiểu chủ đề chung trong 1 phút.

CẤU TRÚC Markdown:
1. **Tổng quan** (3-4 câu): chủ đề chung, mục tiêu học gì
2. **Các phần chính** (3-5 bullet): mỗi phần 1 dòng
3. **Bắt đầu từ đâu?** (1 câu khuyến nghị)

QUY TẮC:
- 200-300 từ, KHÔNG VƯỢT.
- Markdown thuần.
- Vietnamese.
- KHÔNG fluff như "Hy vọng briefing này...".`;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: workspaceId } = await params;
  const url = new URL(request.url);
  const force = url.searchParams.get('regenerate') === '1';

  const [ws] = await db
    .select({ id: workspace.id, name: workspace.name, description: workspace.description })
    .from(workspace)
    .where(and(eq(workspace.id, workspaceId), eq(workspace.userId, session.user.id)))
    .limit(1);
  if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Check persistent cache (V6)
  if (!force) {
    const [cached] = await db
      .select()
      .from(workspaceCachedOutput)
      .where(
        and(
          eq(workspaceCachedOutput.workspaceId, workspaceId),
          eq(workspaceCachedOutput.userId, session.user.id),
          eq(workspaceCachedOutput.kind, 'briefing'),
        ),
      )
      .limit(1);
    if (cached && Date.now() - cached.generatedAt.getTime() < CACHE_TTL_MS) {
      const meta = cached.meta as { docCount?: number };
      return NextResponse.json({
        markdown: cached.markdown,
        generatedAt: cached.generatedAt.toISOString(),
        docCount: meta.docCount ?? 0,
        fromCache: true,
      });
    }
  }

  // Load documents
  const docs = await db
    .select({ id: document.id, filename: document.filename })
    .from(document)
    .where(
      and(
        eq(document.workspaceId, workspaceId),
        eq(document.userId, session.user.id),
      ),
    )
    .limit(10);

  if (docs.length === 0) {
    return NextResponse.json({
      markdown: `# ${ws.name}\n\nWorkspace chưa có document nào. Upload PDF để bắt đầu.`,
      generatedAt: new Date().toISOString(),
      docCount: 0,
      fromCache: false,
    });
  }

  // Load 5 chunks/doc (representative — chunk_index ASC để lấy đầu doc)
  const docIds = docs.map((d) => d.id);
  const chunks = await db
    .select({
      docId: chunk.documentId,
      content: chunk.content,
      metadata: chunk.metadata,
    })
    .from(chunk)
    .where(inArray(chunk.documentId, docIds))
    .orderBy(asc(sql`(${chunk.metadata}->>'chunkIndex')::int`))
    .limit(MAX_CHUNKS_TOTAL);

  // Group by doc, lấy max CHUNKS_PER_DOC mỗi doc
  const byDoc = new Map<string, string[]>();
  for (const c of chunks) {
    const list = byDoc.get(c.docId) ?? [];
    if (list.length < CHUNKS_PER_DOC) {
      list.push(c.content.slice(0, 500));
      byDoc.set(c.docId, list);
    }
  }

  // Build prompt
  const docBlocks = docs
    .map((d) => {
      const cs = byDoc.get(d.id) ?? [];
      return `### ${d.filename}\n${cs.map((c) => c.replace(/\s+/g, ' ').slice(0, 400)).join('\n\n')}`;
    })
    .join('\n\n---\n\n');

  const userPrompt = `Workspace: **${ws.name}**${
    ws.description ? `\n\nMô tả user: ${ws.description}` : ''
  }\n\nNội dung sources:\n\n${docBlocks}`;

  const plan = ((session.user as { plan?: string }).plan ?? 'FREE') as Plan;
  let result;
  try {
    result = await routedGenerateText({
      useCase: 'summarize',
      userId: session.user.id,
      plan,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      maxOutputTokens: 800,
      feature: 'workspace-briefing',
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'LLM gen lỗi — thử lại sau',
      },
      { status: 503 },
    );
  }

  const now = new Date();
  // Upsert persistent cache (V6)
  await db
    .insert(workspaceCachedOutput)
    .values({
      workspaceId,
      userId: session.user.id,
      kind: 'briefing',
      markdown: result.text,
      meta: { docCount: docs.length },
      generatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        workspaceCachedOutput.workspaceId,
        workspaceCachedOutput.userId,
        workspaceCachedOutput.kind,
      ],
      set: {
        markdown: result.text,
        meta: { docCount: docs.length },
        generatedAt: now,
      },
    });

  return NextResponse.json({
    markdown: result.text,
    generatedAt: now.toISOString(),
    docCount: docs.length,
    fromCache: false,
  });
}
