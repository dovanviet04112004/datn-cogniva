import { Injectable } from '@nestjs/common';

import { LlmService } from '../../infra/ai/llm.service';

const CHUNK_WORD_LIMIT = 5_000;
const SINGLE_SHOT_THRESHOLD = 8_000;

export type FlashcardDraft = {
  front: string;
  back: string;
};

const SUMMARY_SYSTEM_PROMPT = `Bạn là trợ lý tóm tắt buổi học cho học sinh/sinh viên Việt Nam.
Tóm tắt bằng TIẾNG VIỆT, format markdown:

**Tóm tắt** (3-5 câu nội dung chính)

**Điểm nổi bật**
- Bullet 1 (concept quan trọng, kèm 1-2 câu giải thích)
- Bullet 2
- Bullet 3-5

**Cần ôn lại**
- Concept/công thức/định lý đáng note

Quy tắc:
- Tổng ≤ 300 từ.
- Không bịa fact ngoài transcript.
- Giữ NGUYÊN tên riêng + công thức + số liệu.`;

function approxWordCount(text: string): number {
  return text.trim().split(/\s+/).length;
}

function chunkByWords(text: string, maxWords: number): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords).join(' '));
  }
  return chunks;
}

@Injectable()
export class SummarizeService {
  constructor(private readonly llm: LlmService) {}

  async summarizeTranscript(transcript: string): Promise<string> {
    const wordCount = approxWordCount(transcript);

    if (wordCount <= SINGLE_SHOT_THRESHOLD) {
      return this.llm.complete(
        `Transcript buổi học:\n\n${transcript}\n\nTóm tắt theo format yêu cầu.`,
        { system: SUMMARY_SYSTEM_PROMPT, maxTokens: 2048 },
      );
    }

    const chunks = chunkByWords(transcript, CHUNK_WORD_LIMIT);
    const partials = await Promise.all(
      chunks.map((chunk, i) =>
        this.llm.complete(`Phần ${i + 1}/${chunks.length}:\n\n${chunk}`, {
          system:
            'Bạn là trợ lý tóm tắt. Tóm tắt đoạn transcript sau thành 100 từ, giữ tên riêng + số liệu.',
        }),
      ),
    );

    return this.llm.complete(
      `Các tóm tắt từng phần của buổi học (gộp lại thành summary cuối):\n\n${partials
        .map((p, i) => `[Phần ${i + 1}]\n${p}`)
        .join('\n\n')}`,
      { system: SUMMARY_SYSTEM_PROMPT, maxTokens: 2048 },
    );
  }

  async generateFlashcardsFromTranscript(
    transcript: string,
    count = 10,
  ): Promise<FlashcardDraft[]> {
    const source =
      approxWordCount(transcript) > 6_000 ? await this.summarizeTranscript(transcript) : transcript;

    const text = await this.llm.complete(
      `Tạo ${count} flashcard từ nội dung sau. Mỗi flashcard có:
- front: câu hỏi ngắn hoặc cloze (≤25 từ) bằng tiếng Việt
- back: đáp án ngắn (1-3 câu) bằng tiếng Việt

Output JSON: [{"front":"...","back":"..."}, ...]

Nội dung:
${source}`,
      {
        system:
          'Bạn là chuyên gia tạo flashcard. Output JSON array hợp lệ duy nhất, KHÔNG có markdown code fence, không text khác.',
        maxTokens: 2048,
      },
    );

    const cleaned = text
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '');

    try {
      const parsed = JSON.parse(cleaned) as Array<{ front?: string; back?: string }>;
      if (!Array.isArray(parsed)) throw new Error('Không phải array');
      return parsed
        .filter((c) => c.front && c.back)
        .map((c) => ({ front: c.front!.trim(), back: c.back!.trim() }));
    } catch (err) {
      console.error('[summarize] flashcard parse fail:', err, 'raw:', text.slice(0, 200));
      return [];
    }
  }
}
