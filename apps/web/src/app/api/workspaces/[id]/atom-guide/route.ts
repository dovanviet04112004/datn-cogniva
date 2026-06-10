/**
 * GET /api/workspaces/[id]/atom-guide — LLM markdown study guide.
 *
 * Phase V5.2 (atom-centric). Spec: docs/plans/v5-notebooklm-layout.md §5.2.
 *
 * Logic:
 *   1. Verify workspace thuộc user
 *   2. Load top 20 atom của workspace (sort theo difficulty + mastery)
 *   3. Call LLM với prompt "Sinh study guide markdown ~500-800 từ"
 *   4. Cache in-memory 24h key=workspaceId
 *
 * Force regenerate qua query `?regenerate=1` (bypass cache).
 *
 * Cache strategy V5.2 MVP: in-memory Map. Restart server = mất cache.
 * V5.3+ migrate sang persistent (workspace.metadata jsonb hoặc table).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';

import {
  chunk,
  chunkConcept,
  concept,
  db,
  document,
  mastery,
  workspace,
  workspaceCachedOutput,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { routedGenerateText } from '@/lib/ai/router';
import type { Plan } from '@/lib/observability/cost-guardrail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
// V6: persistent cache via workspace_cached_output table (migration 0035)
// thay vì in-memory Map — survive server restart.

const SYSTEM_PROMPT = `Bạn là tutor giúp học sinh tổng kết kiến thức. Sinh study guide Markdown ngắn (500-800 từ) từ list atom kiến thức dưới đây.

CẤU TRÚC:
1. Tóm tắt 1 đoạn (3-4 câu) về chủ đề chung của workspace
2. Mỗi atom = 1 section "## <Tên atom>" với:
   - Định nghĩa cô đọng (1-2 câu)
   - Ví dụ ngắn
   - "Tự hỏi:" 1 câu hỏi ngắn
3. Cuối: 1 bảng so sánh atoms nếu hợp lý (markdown table)

QUY TẮC:
- Markdown thuần — heading, list, bold, italic, table. KHÔNG code block.
- Vietnamese.
- KHÔNG thêm intro / outro fluff như "Hy vọng study guide này hữu ích".
- Đi thẳng vào nội dung.`;

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
    .select({ id: workspace.id, name: workspace.name })
    .from(workspace)
    .where(and(eq(workspace.id, workspaceId), eq(workspace.userId, session.user.id)))
    .limit(1);
  if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Check persistent cache (V6: DB thay in-memory Map)
  if (!force) {
    const [cached] = await db
      .select()
      .from(workspaceCachedOutput)
      .where(
        and(
          eq(workspaceCachedOutput.workspaceId, workspaceId),
          eq(workspaceCachedOutput.userId, session.user.id),
          eq(workspaceCachedOutput.kind, 'atom-guide'),
        ),
      )
      .limit(1);
    if (cached && Date.now() - cached.generatedAt.getTime() < CACHE_TTL_MS) {
      const meta = cached.meta as { atomCount?: number };
      return NextResponse.json({
        markdown: cached.markdown,
        generatedAt: cached.generatedAt.toISOString(),
        atomCount: meta.atomCount ?? 0,
        fromCache: true,
      });
    }
  }

  // Load atoms — top 20 theo difficulty DESC NULLS LAST + mastery ASC NULLS FIRST
  const conceptIdRows = await db
    .selectDistinct({ id: chunkConcept.conceptId })
    .from(chunkConcept)
    .innerJoin(chunk, eq(chunk.id, chunkConcept.chunkId))
    .innerJoin(document, eq(document.id, chunk.documentId))
    .where(
      and(
        eq(document.workspaceId, workspaceId),
        eq(document.userId, session.user.id),
      ),
    );
  const conceptIds = conceptIdRows.map((r) => r.id);

  if (conceptIds.length === 0) {
    return NextResponse.json({
      markdown: `# ${ws.name}\n\nWorkspace chưa có atom nào. Upload PDF + đợi AI extract (~30-60s) rồi quay lại đây.`,
      generatedAt: new Date().toISOString(),
      atomCount: 0,
      fromCache: false,
    });
  }

  const atoms = await db
    .select({
      id: concept.id,
      name: concept.name,
      description: concept.description,
      domain: concept.domain,
      examples: concept.examples,
      difficulty: concept.difficulty,
      previewQuestion: concept.previewQuestion,
      previewAnswer: concept.previewAnswer,
    })
    .from(concept)
    .where(inArray(concept.id, conceptIds))
    .limit(20);

  // Build input prompt cho LLM
  const masteryRows = await db
    .select()
    .from(mastery)
    .where(
      and(eq(mastery.userId, session.user.id), inArray(mastery.conceptId, conceptIds)),
    );
  const masteryMap = new Map(masteryRows.map((m) => [m.conceptId, m.score]));

  const atomBlock = atoms
    .map((a) => {
      const examples =
        Array.isArray(a.examples) && a.examples.length > 0
          ? (a.examples as string[]).slice(0, 2).join('; ')
          : '';
      const mScore = masteryMap.get(a.id);
      return `### ${a.name} (${a.domain}${a.difficulty !== null ? `, độ khó ${(a.difficulty * 100).toFixed(0)}%` : ''}${mScore !== undefined ? `, mastery ${(mScore * 100).toFixed(0)}%` : ''})\n- Định nghĩa: ${a.description ?? '(chưa có)'}${examples ? `\n- Ví dụ: ${examples}` : ''}${a.previewQuestion ? `\n- Q: ${a.previewQuestion}` : ''}`;
    })
    .join('\n\n');

  const userPrompt = `Workspace: **${ws.name}**\n\nDanh sách atom:\n\n${atomBlock}`;

  // Call LLM
  const plan = ((session.user as { plan?: string }).plan ?? 'FREE') as Plan;
  let result;
  try {
    result = await routedGenerateText({
      useCase: 'summarize',
      userId: session.user.id,
      plan,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      maxOutputTokens: 2000,
      feature: 'atom-guide',
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
  // Upsert vào DB cache — ON CONFLICT UPDATE giữ row mới nhất per (ws×user×kind)
  await db
    .insert(workspaceCachedOutput)
    .values({
      workspaceId,
      userId: session.user.id,
      kind: 'atom-guide',
      markdown: result.text,
      meta: { atomCount: atoms.length },
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
        meta: { atomCount: atoms.length },
        generatedAt: now,
      },
    });

  return NextResponse.json({
    markdown: result.text,
    generatedAt: now.toISOString(),
    atomCount: atoms.length,
    fromCache: false,
  });
}
