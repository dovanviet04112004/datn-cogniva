# Upload pipeline — cải tiến deferred

Ghi chú các nâng cấp cho document upload + ingest. Để dành làm sau khi
fix các thứ khác. Sẽ kéo lên implement khi cần.

Created: 2026-05-14

---

## Tình trạng hiện tại

- **Upload route** [apps/web/src/app/api/documents/upload/route.ts](../../apps/web/src/app/api/documents/upload/route.ts)
  - MIME whitelist: `application/pdf` (CHỈ PDF)
  - Max size: 50 MB / file
  - Sync ingest trong route handler (block 5-30s)
  - Accept optional `workspaceId` từ form (chat composer dùng)
  - Fallback: `getOrCreateDefaultWorkspace(userId)` — lazy tạo workspace
    "Default" lần đầu

- **Pipeline** [apps/web/src/lib/ingest/pipeline.ts](../../apps/web/src/lib/ingest/pipeline.ts)
  - Throw cứng nếu `mimeType !== 'application/pdf'`
  - Dùng `unpdf` để parse → chunk page-aware → embed Voyage/OpenAI →
    insert pgvector → mark READY

- **Chat composer** [apps/web/src/components/chat/chat-interface.tsx](../../apps/web/src/components/chat/chat-interface.tsx)
  - File input `accept="application/pdf,.pdf"` only
  - Filter client: `f.type === 'application/pdf'`
  - Upload trước khi send message → block UI loading

→ **DOCX, MD, TXT, HTML, URL, YouTube, OCR đều CHƯA support.** Workspace
schema thì lưu được bất kỳ MIME nào (column tự do), chỉ là pipeline reject.

---

## Đợt 1 — TXT + MD (easy win)

- **Effort**: ~30 phút
- **Dep**: None (UTF-8 decode thẳng)
- **MIME**: `text/plain`, `text/markdown`, fallback theo extension `.txt` `.md`

**Việc cần làm:**

1. `lib/ingest/parse/text.ts` mới: `parseText(buffer) → { pages: [{ pageNumber: 1, text }] }`
   - TXT: `buffer.toString('utf-8')` trực tiếp
   - MD: parse markdown nếu muốn split theo heading `#`, hoặc giữ
     nguyên Markdown source (LLM hiểu Markdown OK)
2. Refactor `pipeline.ts` → dispatcher `parseDocument(buffer, mimeType)`
   - switch theo MIME → gọi parser tương ứng
   - Tất cả parser trả về cùng shape `{ pages, totalPages }`
3. Update upload route `ALLOWED_MIME` + client `accept` attribute

---

## Đợt 2 — DOCX

- **Effort**: ~1h
- **Dep mới**: `mammoth` (~200KB)
  ```bash
  pnpm add mammoth --filter @cogniva/web
  ```
- **MIME**: `application/vnd.openxmlformats-officedocument.wordprocessingml.document`

**Việc cần làm:**

1. `lib/ingest/parse/docx.ts`:
   ```ts
   import mammoth from 'mammoth';
   export async function parseDocx(buffer: Buffer) {
     const { value } = await mammoth.extractRawText({ buffer });
     // DOCX không có khái niệm page → fake pageNumber=1, hoặc split
     // theo `\f` (form feed) nếu có heading break
     return { pages: [{ pageNumber: 1, text: value }], totalPages: 1 };
   }
   ```
2. Add MIME vào whitelist
3. Test với .docx có table, hình → fallback nếu mammoth fail

**Caveat**: DOCX có ảnh/table → mammoth chỉ trả text. Mất diagram nhưng
chấp nhận được cho V1.

---

## Đợt 3 — HTML / URL paste

- **Effort**: ~2h
- **Dep mới**: `@mozilla/readability` (jsdom đã có)
- **MIME**: `text/html` (file upload), hoặc URL string input riêng

**Việc cần làm:**

1. `lib/ingest/parse/html.ts`:
   ```ts
   import { JSDOM } from 'jsdom';
   import { Readability } from '@mozilla/readability';
   export function parseHtml(buffer: Buffer) {
     const dom = new JSDOM(buffer.toString('utf-8'));
     const article = new Readability(dom.window.document).parse();
     return { pages: [{ pageNumber: 1, text: article?.textContent ?? '' }] };
   }
   ```
2. New endpoint `/api/documents/from-url` — fetch URL → pass buffer qua parseHtml
3. UI: chat composer thêm option "Đính kèm URL" → input modal
4. Caveat: paywall, JS-rendered SPA, robots.txt → cần error handling

---

## Đợt 4 — YouTube

- **Effort**: ~2h
- **Dep mới**: `youtube-transcript` lib (hoặc dùng Whisper nếu video không
  có caption)
- **Input**: URL YouTube paste vào chat

**Việc cần làm:**

1. Detect YouTube URL pattern (`youtube.com/watch?v=` / `youtu.be/`)
2. `lib/ingest/parse/youtube.ts`:
   - Try `youtube-transcript` lib (free, lấy caption nếu có)
   - Fallback: download audio → Groq Whisper (đã có pipeline cho voice)
3. Inject metadata: video title + duration vào document.metadata
4. Citation jump-to-timestamp: chunk có `metadata.startSec` → click citation
   mở YouTube embed ở đúng thời gian

---

## Đợt 5 — OCR (PDF scan, ảnh)

- **Effort**: ~4h
- **Dep mới**:
  - Tesseract.js (~50MB WASM, client/server) — free nhưng chậm
  - Hoặc Google Cloud Vision API — chính xác hơn, có cost
  - Hoặc Mistral OCR API
- **Input**: PDF không có text layer (parse được 0 chunk), hoặc upload ảnh

**Việc cần làm:**

1. Detect: `parsePdf` trả 0 chunk → trigger OCR fallback (hiện đang throw)
2. `lib/ingest/parse/ocr.ts`: render PDF page → image → Tesseract → text
3. Async pipeline (BullMQ) vì OCR mất 30s-2min cho PDF lớn
4. UI: hiển thị "Đang OCR..." status thay vì FAILED

---

## Refactor architecture (cần làm trước đợt 1)

Hiện `pipeline.ts` gọi thẳng `parsePdf`. Cần dispatcher pattern:

```ts
// lib/ingest/parse/index.ts (mới)
import { parsePdf } from './pdf';
import { parseText } from './text';
import { parseDocx } from './docx';
import { parseHtml } from './html';

type ParseResult = {
  pages: Array<{ pageNumber: number; text: string }>;
  totalPages: number;
};

export async function parseDocument(
  buffer: Buffer,
  mimeType: string,
  filename?: string,
): Promise<ParseResult> {
  // Detect bằng MIME, fallback extension nếu MIME unknown
  const ext = filename?.toLowerCase().split('.').pop();

  if (mimeType === 'application/pdf' || ext === 'pdf') return parsePdf(buffer);
  if (mimeType === 'text/plain' || ext === 'txt') return parseText(buffer);
  if (mimeType === 'text/markdown' || ext === 'md') return parseText(buffer);
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  )
    return parseDocx(buffer);
  if (mimeType === 'text/html' || ext === 'html') return parseHtml(buffer);

  throw new Error(`Unsupported format: ${mimeType} (${ext})`);
}
```

Pipeline chỉ cần đổi 1 dòng:

```ts
// Trước
const parsed = await parsePdf(buffer);
// Sau
const parsed = await parseDocument(buffer, doc.mimeType, doc.filename);
```

Chunk + embed + retrieval **không cần đổi** — interface `{ pages, totalPages }`
giữ nguyên.

---

## Performance optimization (orthogonal)

Vấn đề khác: hiện ingest CHẠY ĐỒNG BỘ trong route handler → block 5-30s.

### Hybrid sync/async (cho chat composer)

```
PDF ≤ 10 trang  → parse text inline → inject vào prompt message đầu  (instant)
                 → background ingest async cho message kế tiếp dùng RAG

PDF > 10 trang  → giữ sync (hiện tại) hoặc swap BullMQ
```

Lý do: hầu hết PDF user upload trong chat là tài liệu nhỏ hỏi nhanh.
PDF lớn user thường upload từ trang /documents.

### BullMQ queue (cho /documents page)

- Phase 1 dev OK chạy sync
- Production phải swap → response 200 ngay, polling status
- Đã có BullMQ queue/worker setup ở [apps/web/src/queue](../../apps/web/src/queue) + [apps/web/src/worker](../../apps/web/src/worker)
- Wrap `ingestDocument` thành job `processDocumentIngestion` với retry policy

---

## Workspace lưu trữ — note

- `document.mimeType` schema là `text` tự do — **lưu được mọi MIME**
- `document.storageKey` pattern hiện tại: `${userId}/${docId}.pdf` —
  cần đổi `pdf` thành `${ext}` khi support multi-format
- `document.filename` giữ tên gốc → dùng cho UI list + download

---

## Roadmap đề xuất

| Đợt | Format     | Effort | Khi nào làm                    |
| --- | ---------- | ------ | ------------------------------ |
| 1   | TXT, MD    | 30m    | Trước, easy win                |
| 2   | DOCX       | 1h     | Sau đợt 1 — coverage tăng mạnh |
| 3   | HTML / URL | 2h     | Khi user request "paste link"  |
| 4   | YouTube    | 2h     | Phase mở rộng learning content |
| 5   | OCR        | 4h     | Khi user upload PDF scan       |

Đợt 1 + 2 cover ~90% format giáo trình/bài giảng thông dụng ở VN.

---

## Liên quan

- [master.md](../plans/master.md) — master spec, có thể link section "Phase X Document
  Ingest extension" về file này
- Schema: `document.mimeType` ở [packages/db/src/schema.ts](../../packages/db/src/schema.ts)
- Chat composer upload UI: [apps/web/src/components/chat/chat-interface.tsx](../../apps/web/src/components/chat/chat-interface.tsx)
