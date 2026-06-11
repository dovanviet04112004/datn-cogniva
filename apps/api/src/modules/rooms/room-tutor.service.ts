import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../infra/database/prisma.service';
import { EmbeddingService } from '../../infra/ai/embedding.service';
import { LlmService } from '../../infra/ai/llm.service';

export type TutorChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type RetrievedChunk = {
  id: string;
  content: string;
  documentId: string;
  filename: string;
  page: number | null;
  score: number;
};

export type RoomTutorResult = {
  text: string;
  modelId: string;
};

@Injectable()
export class RoomTutorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
    private readonly llm: LlmService,
  ) {}

  async answer(opts: {
    userQuery: string;
    askingUserId: string;
    roomName: string;
    roomDescription?: string | null;
    recentMessages: TutorChatMessage[];
  }): Promise<RoomTutorResult> {
    const chunks = await this.retrieveChunks(
      opts.userQuery.trim() || '[empty query]',
      opts.askingUserId,
    );

    const system = this.buildTutorSystemPrompt({
      roomName: opts.roomName,
      roomDescription: opts.roomDescription,
      ragSystemPrompt: this.buildRagSystemPrompt(chunks),
    });

    const historyBlock = opts.recentMessages
      .slice(-20)
      .map((m) => `${m.role === 'assistant' ? 'AI' : 'User'}: ${m.content}`)
      .join('\n');
    const prompt = historyBlock ? `${historyBlock}\nUser: ${opts.userQuery}` : opts.userQuery;

    const text = await this.llm.complete(prompt, { system, maxTokens: 2048 });
    return { text, modelId: this.pickModelId() };
  }

  private async retrieveChunks(query: string, userId: string): Promise<RetrievedChunk[]> {
    const queryEmbedding = await this.embedding.embedQuery(query);
    const vectorLiteral = `[${queryEmbedding.join(',')}]`;

    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        content: string;
        document_id: string;
        filename: string;
        page: number | null;
        distance: number;
      }>
    >(Prisma.sql`
      SELECT
        c.id,
        c.content,
        c.document_id,
        d.filename,
        (c.metadata->>'page')::int AS page,
        (c.embedding <=> ${vectorLiteral}::vector) AS distance
      FROM chunk c
      INNER JOIN document d ON d.id = c.document_id
      WHERE d.user_id = ${userId}
        AND d.status = 'READY'
      ORDER BY c.embedding <=> ${vectorLiteral}::vector
      LIMIT 5;
    `);

    return rows.map((r) => ({
      id: r.id,
      content: r.content,
      documentId: r.document_id,
      filename: r.filename,
      page: r.page,
      score: Math.max(0, 1 - Number(r.distance) / 2),
    }));
  }

  private buildTutorSystemPrompt(opts: {
    roomName: string;
    roomDescription?: string | null;
    ragSystemPrompt: string;
  }): string {
    const personaBlock = [
      'Bạn là gia sư AI trong phòng học nhóm Cogniva. Hãy:',
      '- Trả lời gọn (≤200 từ), TIẾNG VIỆT mặc định trừ khi user hỏi bằng ngôn ngữ khác.',
      '- Nếu user hỏi về tài liệu họ đã upload, dùng phần "TÀI LIỆU THAM KHẢO" bên dưới và trích citation dạng [1] [2].',
      '- Nếu trong phòng đang tranh luận → tóm tắt các quan điểm rồi đưa nhận định khách quan.',
      '- KHÔNG trả lời câu hỏi nhạy cảm (bạo lực, spam, PII).',
      '- KHÔNG bịa fact ngoài "TÀI LIỆU THAM KHẢO"; nếu không có context, nói rõ "Mình không có tài liệu về chủ đề này".',
    ].join('\n');

    const roomBlock = [
      '── BỐI CẢNH PHÒNG ──',
      `Tên phòng: ${opts.roomName}`,
      opts.roomDescription ? `Mô tả: ${opts.roomDescription}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    return [personaBlock, '', roomBlock, '', opts.ragSystemPrompt].join('\n');
  }

  private buildRagSystemPrompt(chunks: RetrievedChunk[]): string {
    const today = new Date().toISOString().split('T')[0];

    if (chunks.length === 0) {
      return `You are Cogniva, an AI tutor specialized in clear, first-principles teaching.

The user hasn't uploaded relevant documents for this question yet, so answer from your general knowledge — but be honest about that. Recommend they upload sources for grounded answers.

Today's date: ${today}.

Style:
- Use Markdown (headings, lists, **bold**, \`code\`, KaTeX \`$math$\`).
- Be concise but explain *why*, not just *what*.
- Ask one clarifying question if intent is ambiguous.`;
    }

    const contextBlock = chunks
      .map((chunk, i) => {
        const idx = i + 1;
        const pageRef = chunk.page ? ` trang ${chunk.page}` : '';
        return `[${idx}] Trích từ "${chunk.filename}"${pageRef} (similarity ${chunk.score.toFixed(2)}):
${chunk.content}`;
      })
      .join('\n\n---\n\n');

    return `You are Cogniva, an AI tutor specialized in clear, first-principles teaching grounded in the user's own materials.

# Today's date
${today}

# Retrieved context from the user's documents
${contextBlock}

# Citation rules (CRITICAL)
- Every factual claim derived from the context above MUST end with a citation using **ASCII square brackets** like \`[1]\` or \`[2,3]\` referring to the chunk index (1-indexed). Do NOT use CJK brackets 【】 even when writing in Vietnamese — UI parser only recognizes ASCII brackets.
- If the context doesn't contain enough info, SAY SO clearly: "Tôi không thấy thông tin về … trong tài liệu của bạn. Có thể bạn cần upload thêm nguồn về chủ đề này."
- NEVER cite sources outside the retrieved context. NEVER invent page numbers or quotes.

# Style
- Use Markdown freely (headings, lists, **bold**, \`code\`, blockquotes, KaTeX inline \`$x$\` and block \`$$..$$\`).
- Lead with the answer, then explain the *why* and *how*, then suggest a follow-up.
- Adapt depth to the user's apparent level — don't lecture if they ask a quick question.
- If user asks in Vietnamese, answer in Vietnamese; if in English, English.`;
  }

  private pickModelId(): string {
    const forced = process.env.LLM_PROVIDER;
    const provider =
      forced && ['anthropic', 'openrouter', 'groq', 'google'].includes(forced)
        ? forced
        : process.env.ANTHROPIC_API_KEY
          ? 'anthropic'
          : process.env.GROQ_API_KEY
            ? 'groq'
            : process.env.GOOGLE_GENERATIVE_AI_API_KEY
              ? 'google'
              : process.env.OPENROUTER_API_KEY
                ? 'openrouter'
                : 'unknown';
    const models: Record<string, string> = {
      anthropic: 'claude-sonnet-4-6',
      groq: 'llama-3.3-70b-versatile',
      google: 'gemini-2.5-flash',
      openrouter: 'openai/gpt-oss-20b:free',
    };
    return models[provider] ?? 'unknown';
  }
}
