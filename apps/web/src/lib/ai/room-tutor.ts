/**
 * roomTutor — AI tutor cho in-room chat (Phase 15).
 *
 * Tại sao KHÔNG dùng Mastra runtime cho version này:
 *   - Đã có Vercel AI SDK + getChatModel + retrieveChunks ổn định (Phase 3).
 *   - Mastra runtime nặng (workflow engine + agent registry) — overkill cho 1
 *     persona "tutor" với 1 tool RAG. Phase 18 (Adaptive Testing) sẽ cần
 *     workflow phức tạp → khi đó mới migrate.
 *   - Vẫn export `streamRoomTutor()` với API tương đương `agent.stream({...})`
 *     để khi swap runtime chỉ đổi import, không sửa route handler.
 *
 * Context cho tutor:
 *   1. Tên room + topic (nếu user set).
 *   2. ≤20 message gần nhất từ room (text only, bỏ FILE/SYSTEM).
 *   3. Top-5 RAG chunks từ docs của user — scope retrieval theo user ASK,
 *      không leak chunks giữa các participant.
 *   4. Câu hỏi hiện tại của user.
 *
 * Streaming pattern:
 *   - `streamText` từ AI SDK trả `textStream` (AsyncIterable<string>).
 *   - Caller (route handler) for-await loop, push từng chunk qua Socket.IO.
 *   - Kết thúc → caller gọi onFinish callback với full text + usage.
 */
import { streamText, type LanguageModel } from 'ai';

import { getChatModel, getChatModelId } from '@/lib/ai/models';
import { buildChatContext, type ChatContext } from '@/lib/chat/pipeline';

/** Message format AI SDK chấp nhận (subset). */
export type TutorChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type StreamRoomTutorOptions = {
  /** Câu hỏi mới nhất của user — dùng làm query cho RAG. */
  userQuery: string;
  /** ID user đang gõ — scope RAG, KHÔNG leak doc của user khác trong room. */
  askingUserId: string;
  /** Tên room (làm context "topic"). */
  roomName: string;
  /** Description ngắn của room (nếu có) — thêm vào system prompt. */
  roomDescription?: string | null;
  /** ≤20 message gần nhất, sort cũ → mới. */
  recentMessages: TutorChatMessage[];
  /** Override model (Phase 15 mặc định Sonnet 4.6, có thể override để test). */
  model?: LanguageModel;
};

/**
 * System prompt cho roomTutor — gộp persona + room context + RAG chunks.
 *
 * Quy ước: tách phần room context (top) khỏi RAG citations (bottom) bằng
 * separator để LLM dễ phân biệt "thông tin phòng" với "tài liệu trích dẫn".
 */
function buildTutorSystemPrompt(opts: {
  roomName: string;
  roomDescription?: string | null;
  ragContext: ChatContext;
}): string {
  const { roomName, roomDescription, ragContext } = opts;

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
    `Tên phòng: ${roomName}`,
    roomDescription ? `Mô tả: ${roomDescription}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  // Tận dụng systemPrompt đã được build sẵn (đã chứa chunks + format citation
  // chuẩn của chat pipeline) — không duplicate logic.
  return [personaBlock, '', roomBlock, '', ragContext.systemPrompt].join('\n');
}

export type RoomTutorStreamResult = {
  /** AsyncIterable<string> — caller for-await để lấy từng delta. */
  textStream: AsyncIterable<string>;
  /** Promise resolve khi stream kết thúc, trả full text + usage. */
  finishPromise: Promise<{
    text: string;
    promptTokens: number;
    completionTokens: number;
    modelId: string;
  }>;
  /** Số chunk RAG đã retrieve — log metric. */
  chunksRetrieved: number;
  /** Retrieval latency (ms). */
  retrievalMs: number;
};

/**
 * Stream câu trả lời từ roomTutor — caller chịu trách nhiệm broadcast qua
 * Socket.IO + persist tin nhắn vào DB.
 *
 * @returns RoomTutorStreamResult — textStream + finishPromise + telemetry
 */
export async function streamRoomTutor(
  opts: StreamRoomTutorOptions,
): Promise<RoomTutorStreamResult> {
  const model = opts.model ?? getChatModel();
  const modelId = getChatModelId();

  // 1. Retrieve RAG chunks (scope theo người HỎI — tránh leak doc người khác)
  const retrievalStart = Date.now();
  const ragContext = await buildChatContext({
    query: opts.userQuery.trim() || '[empty query]',
    userId: opts.askingUserId,
  });
  const retrievalMs = Date.now() - retrievalStart;

  // 2. Build messages array cho streamText
  const systemPrompt = buildTutorSystemPrompt({
    roomName: opts.roomName,
    roomDescription: opts.roomDescription,
    ragContext,
  });

  const messages: TutorChatMessage[] = [
    ...opts.recentMessages.slice(-20), // tối đa 20 msg gần nhất
    { role: 'user', content: opts.userQuery },
  ];

  // 3. streamText — promise resolve khi setup xong, textStream tiếp tục async
  let resolveFinish!: (v: {
    text: string;
    promptTokens: number;
    completionTokens: number;
    modelId: string;
  }) => void;
  let rejectFinish!: (e: unknown) => void;
  const finishPromise = new Promise<{
    text: string;
    promptTokens: number;
    completionTokens: number;
    modelId: string;
  }>((resolve, reject) => {
    resolveFinish = resolve;
    rejectFinish = reject;
  });

  const result = streamText({
    model,
    system: systemPrompt,
    messages,
    onFinish: ({ text, usage }) => {
      resolveFinish({
        text,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        modelId,
      });
    },
    onError: ({ error }) => {
      console.error('[roomTutor] streamText error:', error);
      rejectFinish(error);
    },
  });

  return {
    textStream: result.textStream,
    finishPromise,
    chunksRetrieved: ragContext.chunks.length,
    retrievalMs,
  };
}
