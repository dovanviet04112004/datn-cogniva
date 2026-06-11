import { Injectable } from '@nestjs/common';

import { LlmService } from '../../infra/ai/llm.service';

export type GradeResult = {
  score: number;
  feedback: string;
};

const SHORT_GRADE_INSTRUCTION = `Bạn là giáo viên chấm bài. So sánh câu trả lời của học sinh với đáp án mẫu, cho điểm 0.0 → 1.0 theo độ chính xác và độ đầy đủ.

QUY TẮC:
- 1.0: trả lời đúng, đủ ý chính.
- 0.6-0.9: đúng ý chính nhưng thiếu chi tiết.
- 0.3-0.5: hiểu sai một phần hoặc bỏ sót nhiều ý.
- 0.0-0.2: sai hoàn toàn hoặc lạc đề.
- Ngôn từ khác đáp án mẫu KHÔNG bị trừ điểm, miễn ý đúng.
- Trả feedback NGẮN (1-2 câu) bằng cùng ngôn ngữ với câu hỏi.

ĐỊNH DẠNG OUTPUT — JSON THUẦN, KHÔNG MARKDOWN:
{"score": 0.85, "feedback": "..."}

CÂU HỎI: {{PROMPT}}

ĐÁP ÁN MẪU: {{CORRECT}}

CÂU TRẢ LỜI CỦA HỌC SINH: {{USER}}`;

function extractJson(text: string): unknown {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Không tìm thấy JSON');
  return JSON.parse(match[0]);
}

@Injectable()
export class QuizGradeService {
  constructor(private readonly llm: LlmService) {}

  gradeMcq(userAnswer: number, correctAnswer: number): GradeResult {
    const correct = userAnswer === correctAnswer;
    return {
      score: correct ? 1 : 0,
      feedback: correct ? 'Chính xác.' : 'Sai đáp án.',
    };
  }

  gradeTrueFalse(userAnswer: boolean, correctAnswer: boolean): GradeResult {
    const correct = userAnswer === correctAnswer;
    return {
      score: correct ? 1 : 0,
      feedback: correct ? 'Chính xác.' : 'Sai đáp án.',
    };
  }

  async gradeShort(
    prompt: string,
    correctAnswer: string,
    userAnswer: string,
  ): Promise<GradeResult> {
    if (!userAnswer.trim()) {
      return { score: 0, feedback: 'Chưa trả lời.' };
    }
    try {
      const text = await this.llm.complete(
        SHORT_GRADE_INSTRUCTION.replace('{{PROMPT}}', prompt)
          .replace('{{CORRECT}}', correctAnswer)
          .replace('{{USER}}', userAnswer),
        { temperature: 0.2, maxTokens: 200 },
      );
      const obj = extractJson(text) as { score?: unknown; feedback?: unknown };
      const rawScore = typeof obj.score === 'number' ? obj.score : 0;
      const score = Math.max(0, Math.min(1, rawScore));
      const feedback =
        typeof obj.feedback === 'string' && obj.feedback.trim() ? obj.feedback.trim() : 'Đã chấm.';
      return { score, feedback };
    } catch (err) {
      console.warn('[grade-short] fallback:', (err as Error).message);
      return { score: 0, feedback: 'Không chấm được, hãy thử lại.' };
    }
  }
}
