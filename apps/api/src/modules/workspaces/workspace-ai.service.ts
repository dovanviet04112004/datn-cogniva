import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { LlmService } from '../../infra/ai/llm.service';
import { CostGuardrailService, type Plan } from '../../infra/ai/cost-guardrail.service';
import { PrismaService } from '../../infra/database/prisma.service';
import type { AuthUser } from '../../common/auth/session.types';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CHUNKS_TOTAL = 25;
const CHUNKS_PER_DOC = 5;

const ATOM_GUIDE_SYSTEM_PROMPT = `Bạn là tutor giúp học sinh tổng kết kiến thức. Sinh study guide Markdown ngắn (500-800 từ) từ list atom kiến thức dưới đây.

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

const BRIEFING_SYSTEM_PROMPT = `Bạn là tutor onboarding học sinh vào workspace mới. Đọc nội dung sources dưới đây và viết briefing 200-300 từ tóm tắt workspace, để học sinh hiểu chủ đề chung trong 1 phút.

CẤU TRÚC Markdown:
1. **Tổng quan** (3-4 câu): chủ đề chung, mục tiêu học gì
2. **Các phần chính** (3-5 bullet): mỗi phần 1 dòng
3. **Bắt đầu từ đâu?** (1 câu khuyến nghị)

QUY TẮC:
- 200-300 từ, KHÔNG VƯỢT.
- Markdown thuần.
- Vietnamese.
- KHÔNG fluff như "Hy vọng briefing này...".`;

@Injectable()
export class WorkspaceAiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly guardrail: CostGuardrailService,
  ) {}

  async atomGuide(user: AuthUser, workspaceId: string, force: boolean) {
    const ws = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, user_id: user.id },
      select: { id: true, name: true },
    });
    if (!ws) throw new NotFoundException({ error: 'Not found' });

    if (!force) {
      const hit = await this.readCache(workspaceId, user.id, 'atom_guide');
      if (hit) {
        const meta = hit.meta as { atomCount?: number };
        return {
          markdown: hit.markdown,
          generatedAt: hit.generated_at.toISOString(),
          atomCount: meta.atomCount ?? 0,
          fromCache: true,
        };
      }
    }

    const conceptIds = await this.workspaceConceptIds(user.id, workspaceId);
    if (conceptIds.length === 0) {
      return {
        markdown: `# ${ws.name}\n\nWorkspace chưa có atom nào. Upload PDF + đợi AI extract (~30-60s) rồi quay lại đây.`,
        generatedAt: new Date().toISOString(),
        atomCount: 0,
        fromCache: false,
      };
    }

    const atoms = await this.prisma.concept.findMany({
      where: { id: { in: conceptIds } },
      take: 20,
      select: {
        id: true,
        name: true,
        description: true,
        domain: true,
        examples: true,
        difficulty: true,
        preview_question: true,
        preview_answer: true,
      },
    });

    const masteryRows = await this.prisma.mastery.findMany({
      where: { user_id: user.id, concept_id: { in: conceptIds } },
      select: { concept_id: true, score: true },
    });
    const masteryMap = new Map(masteryRows.map((m) => [m.concept_id, m.score]));

    const atomBlock = atoms
      .map((a) => {
        const examples =
          Array.isArray(a.examples) && a.examples.length > 0
            ? (a.examples as string[]).slice(0, 2).join('; ')
            : '';
        const mScore = masteryMap.get(a.id);
        return `### ${a.name} (${a.domain}${a.difficulty !== null ? `, độ khó ${(a.difficulty * 100).toFixed(0)}%` : ''}${mScore !== undefined ? `, mastery ${(mScore * 100).toFixed(0)}%` : ''})\n- Định nghĩa: ${a.description ?? '(chưa có)'}${examples ? `\n- Ví dụ: ${examples}` : ''}${a.preview_question ? `\n- Q: ${a.preview_question}` : ''}`;
      })
      .join('\n\n');

    const userPrompt = `Workspace: **${ws.name}**\n\nDanh sách atom:\n\n${atomBlock}`;

    const markdown = await this.generateGuarded({
      user,
      system: ATOM_GUIDE_SYSTEM_PROMPT,
      prompt: userPrompt,
      maxTokens: 2000,
      feature: 'atom-guide',
    });

    const now = new Date();
    await this.upsertCache(
      workspaceId,
      user.id,
      'atom_guide',
      markdown,
      { atomCount: atoms.length },
      now,
    );

    return {
      markdown,
      generatedAt: now.toISOString(),
      atomCount: atoms.length,
      fromCache: false,
    };
  }

  async briefing(user: AuthUser, workspaceId: string, force: boolean) {
    const ws = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, user_id: user.id },
      select: { id: true, name: true, description: true },
    });
    if (!ws) throw new NotFoundException({ error: 'Not found' });

    if (!force) {
      const hit = await this.readCache(workspaceId, user.id, 'briefing');
      if (hit) {
        const meta = hit.meta as { docCount?: number };
        return {
          markdown: hit.markdown,
          generatedAt: hit.generated_at.toISOString(),
          docCount: meta.docCount ?? 0,
          fromCache: true,
        };
      }
    }

    const docs = await this.prisma.document.findMany({
      where: { workspace_id: workspaceId, user_id: user.id },
      select: { id: true, filename: true },
      take: 10,
    });

    if (docs.length === 0) {
      return {
        markdown: `# ${ws.name}\n\nWorkspace chưa có document nào. Upload PDF để bắt đầu.`,
        generatedAt: new Date().toISOString(),
        docCount: 0,
        fromCache: false,
      };
    }

    const docIds = docs.map((d) => d.id);
    const chunks = await this.prisma.$queryRaw<
      Array<{ docId: string; content: string }>
    >(Prisma.sql`
      SELECT document_id AS "docId", content
      FROM chunk
      WHERE document_id IN (${Prisma.join(docIds)})
      ORDER BY (metadata->>'chunkIndex')::int ASC
      LIMIT ${MAX_CHUNKS_TOTAL}`);

    const byDoc = new Map<string, string[]>();
    for (const c of chunks) {
      const list = byDoc.get(c.docId) ?? [];
      if (list.length < CHUNKS_PER_DOC) {
        list.push(c.content.slice(0, 500));
        byDoc.set(c.docId, list);
      }
    }

    const docBlocks = docs
      .map((d) => {
        const cs = byDoc.get(d.id) ?? [];
        return `### ${d.filename}\n${cs.map((c) => c.replace(/\s+/g, ' ').slice(0, 400)).join('\n\n')}`;
      })
      .join('\n\n---\n\n');

    const userPrompt = `Workspace: **${ws.name}**${
      ws.description ? `\n\nMô tả user: ${ws.description}` : ''
    }\n\nNội dung sources:\n\n${docBlocks}`;

    const markdown = await this.generateGuarded({
      user,
      system: BRIEFING_SYSTEM_PROMPT,
      prompt: userPrompt,
      maxTokens: 800,
      feature: 'workspace-briefing',
    });

    const now = new Date();
    await this.upsertCache(
      workspaceId,
      user.id,
      'briefing',
      markdown,
      { docCount: docs.length },
      now,
    );

    return {
      markdown,
      generatedAt: now.toISOString(),
      docCount: docs.length,
      fromCache: false,
    };
  }

  private readCache(workspaceId: string, userId: string, kind: 'atom_guide' | 'briefing') {
    return this.prisma.workspace_cached_output
      .findFirst({ where: { workspace_id: workspaceId, user_id: userId, kind } })
      .then((row) => (row && Date.now() - row.generated_at.getTime() < CACHE_TTL_MS ? row : null));
  }

  private async upsertCache(
    workspaceId: string,
    userId: string,
    kind: 'atom_guide' | 'briefing',
    markdown: string,
    meta: Record<string, number>,
    now: Date,
  ): Promise<void> {
    await this.prisma.workspace_cached_output.upsert({
      where: { workspace_id_user_id_kind: { workspace_id: workspaceId, user_id: userId, kind } },
      create: {
        id: randomUUID(),
        workspace_id: workspaceId,
        user_id: userId,
        kind,
        markdown,
        meta,
        generated_at: now,
      },
      update: { markdown, meta, generated_at: now },
    });
  }

  private async workspaceConceptIds(userId: string, workspaceId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT DISTINCT cc.concept_id AS id
      FROM chunk_concept cc
      INNER JOIN chunk ch ON ch.id = cc.chunk_id
      INNER JOIN document d ON d.id = ch.document_id
      WHERE d.workspace_id = ${workspaceId} AND d.user_id = ${userId}`);
    return rows.map((r) => r.id);
  }

  private async generateGuarded(args: {
    user: AuthUser;
    system: string;
    prompt: string;
    maxTokens: number;
    feature: string;
  }): Promise<string> {
    const plan = (args.user.plan ?? 'FREE') as Plan;
    try {
      const pricing = this.currentPricing();
      const tokensIn = Math.ceil((args.system.length + args.prompt.length) / 3);
      const estimatedCostUsd =
        (tokensIn / 1_000_000) * pricing.inputPerM +
        (args.maxTokens / 1_000_000) * pricing.outputPerM;

      const guard = await this.guardrail.check({ userId: args.user.id, plan, estimatedCostUsd });
      if (!guard.allowed) throw new Error(guard.message);

      const text = await this.llm.complete(args.prompt, {
        system: args.system,
        maxTokens: args.maxTokens,
      });

      const tokensOut = Math.ceil(text.length / 3);
      await this.guardrail.record({
        userId: args.user.id,
        plan,
        actualCostUsd:
          (tokensIn / 1_000_000) * pricing.inputPerM + (tokensOut / 1_000_000) * pricing.outputPerM,
        model: pricing.model,
        feature: args.feature,
        provider: pricing.provider,
        tokensIn,
        tokensOut,
      });

      return text;
    } catch (err) {
      throw new ServiceUnavailableException({
        error: err instanceof Error ? err.message : 'LLM gen lỗi — thử lại sau',
      });
    }
  }

  private currentPricing(): {
    provider: string;
    model: string;
    inputPerM: number;
    outputPerM: number;
  } {
    const forced = process.env.LLM_PROVIDER;
    const pick =
      forced && ['anthropic', 'groq', 'google', 'openrouter'].includes(forced)
        ? forced
        : process.env.ANTHROPIC_API_KEY
          ? 'anthropic'
          : process.env.GROQ_API_KEY
            ? 'groq'
            : process.env.GOOGLE_GENERATIVE_AI_API_KEY
              ? 'google'
              : 'openrouter';
    switch (pick) {
      case 'anthropic':
        return { provider: 'anthropic', model: 'claude-sonnet-4-6', inputPerM: 3, outputPerM: 15 };
      case 'groq':
        return { provider: 'groq', model: 'llama-3.3-70b-versatile', inputPerM: 0, outputPerM: 0 };
      case 'google':
        return { provider: 'google', model: 'gemini-2.5-flash', inputPerM: 0, outputPerM: 0 };
      default:
        return {
          provider: 'openrouter',
          model: 'openai/gpt-oss-20b:free',
          inputPerM: 0,
          outputPerM: 0,
        };
    }
  }
}
