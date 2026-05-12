/**
 * Summarize helper — tạo tóm tắt buổi học từ transcript.
 *
 * Phase 15 dùng cho post-processing pipeline (process-recording.ts):
 *   - Input: transcript đầy đủ (có thể 10K+ từ với buổi 60 phút)
 *   - Output: 200-300 từ tiếng Việt, structured (highlights + main points)
 *
 * Strategy:
 *   - Transcript < 8K từ → 1 shot summarize.
 *   - ≥ 8K → chunk 5K từ, summarize từng chunk, gộp lại summarize lần 2
 *     (map-reduce). Phase 18 sẽ dùng Mastra workflow với refine pattern.
 *
 * Cũng export `generateFlashcardsFromTranscript()` cho cùng pipeline — tách
 * step vì rate limit + retry độc lập.
 */
import { generateText } from 'ai';

import { getChatModel } from './models';

const CHUNK_WORD_LIMIT = 5_000;
const SINGLE_SHOT_THRESHOLD = 8_000;

export type FlashcardDraft = {
  /** Mặt trước (câu hỏi/cloze). */
  front: string;
  /** Mặt sau (đáp án/giải thích). */
  back: string;
};

/**
 * Đếm token "thô" qua word split — đủ chính xác cho phán đoán chunk strategy.
 * Token thực tế thường ~1.3 × số từ tiếng Việt; không cần tokenizer thật.
 */
function approxWordCount(text: string): number {
  return text.trim().split(/\s+/).length;
}

/** Chia text thành chunks tối đa `maxWords` từ mỗi chunk, ưu tiên cut tại '. '. */
function chunkByWords(text: string, maxWords: number): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords).join(' '));
  }
  return chunks;
}

/**
 * Summarize transcript buổi học.
 *
 * @returns Tóm tắt tiếng Việt, ~200-300 từ, có header "**Highlights**" + bullet.
 */
export async function summarizeTranscript(transcript: string): Promise<string> {
  const wordCount = approxWordCount(transcript);
  const model = getChatModel();

  if (wordCount <= SINGLE_SHOT_THRESHOLD) {
    const { text } = await generateText({
      model,
      system: SUMMARY_SYSTEM_PROMPT,
      prompt: `Transcript buổi học:\n\n${transcript}\n\nTóm tắt theo format yêu cầu.`,
    });
    return text;
  }

  // Map-reduce cho transcript dài
  const chunks = chunkByWords(transcript, CHUNK_WORD_LIMIT);
  const partials = await Promise.all(
    chunks.map(async (chunk, i) => {
      const { text } = await generateText({
        model,
        system: 'Bạn là trợ lý tóm tắt. Tóm tắt đoạn transcript sau thành 100 từ, giữ tên riêng + số liệu.',
        prompt: `Phần ${i + 1}/${chunks.length}:\n\n${chunk}`,
      });
      return text;
    }),
  );

  const { text } = await generateText({
    model,
    system: SUMMARY_SYSTEM_PROMPT,
    prompt: `Các tóm tắt từng phần của buổi học (gộp lại thành summary cuối):\n\n${partials
      .map((p, i) => `[Phần ${i + 1}]\n${p}`)
      .join('\n\n')}`,
  });
  return text;
}

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

/**
 * Generate flashcards (front/back) từ transcript — pipeline post-processing
 * tự động tạo deck cho buổi học (Phase 5 SR system sẽ schedule review).
 *
 * @param transcript - Full transcript (đã có từ Whisper).
 * @param count - Số flashcard muốn tạo (default 10).
 * @returns Mảng FlashcardDraft — caller insert vào `flashcard` table.
 */
export async function generateFlashcardsFromTranscript(
  transcript: string,
  count = 10,
): Promise<FlashcardDraft[]> {
  // Nếu transcript quá dài → tóm tắt trước rồi gen từ tóm tắt (tránh context bloat)
  const source = approxWordCount(transcript) > 6_000
    ? await summarizeTranscript(transcript)
    : transcript;

  const { text } = await generateText({
    model: getChatModel(),
    system:
      'Bạn là chuyên gia tạo flashcard. Output JSON array hợp lệ duy nhất, KHÔNG có markdown code fence, không text khác.',
    prompt: `Tạo ${count} flashcard từ nội dung sau. Mỗi flashcard có:
- front: câu hỏi ngắn hoặc cloze (≤25 từ) bằng tiếng Việt
- back: đáp án ngắn (1-3 câu) bằng tiếng Việt

Output JSON: [{"front":"...","back":"..."}, ...]

Nội dung:
${source}`,
  });

  // Parse với fallback (LLM đôi khi vẫn wrap code fence dù được dặn)
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
