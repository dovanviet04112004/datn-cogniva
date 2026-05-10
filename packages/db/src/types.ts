/**
 * Khai báo kiểu TypeScript cho các cột jsonb trong Drizzle schema.
 *
 * Vì sao tách ra file riêng?
 *  - jsonb cho phép lưu cấu trúc tự do nhưng nếu không gắn type sẽ thành `any`
 *    → mất hết lợi ích typesafe của Drizzle.
 *  - Các kiểu này được dùng qua `.$type<UserPreferences>()` trong schema.ts
 *    để Drizzle suy luận đúng kiểu khi select/insert.
 *  - Khi cần đổi cấu trúc, sửa ở đây thay vì rải rác khắp app code.
 */

/** Tuỳ chọn cá nhân hoá việc học của người dùng (lưu ở cột user.preferences). */
export type UserPreferences = {
  /** Mã ngôn ngữ ISO 639-1, ví dụ "vi", "en" — ảnh hưởng prompt tutor + UI i18n. */
  language?: string;
  /** Phong cách học chính (dùng để điều chỉnh format trả lời của AI tutor). */
  learningStyle?: 'visual' | 'auditory' | 'reading' | 'kinesthetic';
  /** Mục tiêu học mỗi ngày (phút). Dùng cho bộ đếm streak + nhắc nhở. */
  dailyGoalMinutes?: number;
  /** Cài đặt Pomodoro tích hợp với study planner. */
  pomodoro?: { workMins: number; breakMins: number };
};

/** Metadata của file tài liệu sau khi đã được ingest. */
export type DocumentMetadata = {
  pageCount?: number;
  language?: string;
  /** Nguồn gốc tài liệu — quyết định pipeline parse khác nhau. */
  source?: 'upload' | 'url' | 'youtube';
  url?: string;
  /** Thời lượng (giây) — chỉ có với video / audio. */
  duration?: number;
};

/** Metadata của 1 chunk (đoạn nhỏ) sau khi cắt từ tài liệu. */
export type ChunkMetadata = {
  /** Trang trong PDF gốc — phục vụ click citation nhảy về vị trí gốc. */
  page?: number;
  /** Tên section/heading gần nhất — giúp tutor trả lời có ngữ cảnh. */
  section?: string;
  /** Vị trí chunk trong tài liệu (0-based) — phục vụ sắp xếp theo thứ tự đọc. */
  chunkIndex: number;
  /** Topic được Haiku trích xuất — dùng cho concept extraction về sau. */
  topics?: string[];
  /** Độ khó ước lượng (0..1) — dùng để adapt difficulty cho learner. */
  difficulty?: number;
  /** Loại nội dung — định tuyến prompt khác nhau (ví dụ "exercise" thì dùng tutor mode). */
  type?: 'narrative' | 'definition' | 'example' | 'exercise' | 'figure';
};

/** Một citation trong câu trả lời AI — dùng để hiển thị nguồn gốc. */
export type Citation = {
  /** ID của chunk được trích dẫn. */
  chunkId: string;
  /** Điểm relevance từ retriever (0..1). */
  score: number;
  /** Đoạn text ngắn để hiển thị popover khi hover citation. */
  snippet: string;
};

/** Metadata gắn vào mỗi message để truy vết hiệu năng + chi phí. */
export type MessageMetadata = {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs?: number;
  costUsd?: number;
  /** Tên chiến lược retrieval đã dùng (basic | hyde | hybrid…) — phục vụ A/B test. */
  retrievalStrategy?: string;
};

/** Cấu hình quiz lúc tạo — sau khi tạo các question đã sinh là cố định. */
export type QuizConfig = {
  /** "adaptive" sẽ điều chỉnh độ khó theo BKT mastery của user. */
  difficulty?: 'easy' | 'medium' | 'hard' | 'adaptive';
  types?: Array<'MCQ' | 'TRUE_FALSE' | 'SHORT' | 'ESSAY' | 'FILL_BLANK'>;
  /** Giới hạn quiz vào danh sách concept (mặc định: lấy theo workspace hiện tại). */
  conceptIds?: string[];
  questionCount?: number;
};
