/**
 * Type chung cho golden dataset + eval runner.
 *
 * Format dataset (file evals/golden.json):
 *   Mảng GoldenItem — mỗi item là 1 cặp (question, ground_truth) sinh từ 1
 *   chunk gốc trong DB. source_chunk_id giúp đo "đo có retrieve đúng chunk
 *   gốc không" (recall@k chính xác).
 *
 * Format kết quả run (file evals/results-*.json):
 *   Mảng RunResult — mỗi item lưu kết quả 2 mode (basic vs advanced) cho
 *   1 question. Dùng cho phân tích delta + báo cáo.
 */

export type GoldenItem = {
  /** ID nội bộ — cuid để tránh clash khi merge nhiều dataset. */
  id: string;
  /** Câu hỏi user sẽ hỏi (do LLM synthesize). */
  question: string;
  /** Câu trả lời đúng dựa trên chunk gốc (do LLM synthesize cùng turn). */
  ground_truth: string;
  /** Chunk gốc đã sinh ra Q-A — dùng đo recall@k. */
  source_chunk_id: string;
  /** Document chứa chunk gốc — dùng debug + log. */
  source_document_id: string;
  /** Tên file để debug. */
  source_filename: string;
};

export type Mode = 'basic' | 'advanced';

export type SingleRun = {
  /** Câu trả lời do LLM sinh khi dùng mode này. */
  answer: string;
  /** Chunks đã retrieve (chỉ id + score đủ cho metrics). */
  retrieved: { id: string; score: number; documentId: string; page: number | null }[];
  /** Latency retrieval (ms). */
  retrievalMs: number;
  /** RAGAS metrics — null nếu chưa run. */
  metrics?: {
    /** Câu trả lời có grounded trong context không (0..1). Cao = ít hallucination. */
    faithfulness: number;
    /** Câu trả lời có liên quan tới câu hỏi không. Cao = đúng intent. */
    answer_relevancy: number;
    /** Context retrieve có liên quan câu hỏi không. Cao = retrieval precise. */
    context_relevancy: number;
    /** Source chunk gốc có nằm trong top-K không (0/1). */
    context_recall: number;
  };
};

export type RunResult = {
  goldenId: string;
  question: string;
  ground_truth: string;
  source_chunk_id: string;
  basic: SingleRun;
  advanced: SingleRun;
};
