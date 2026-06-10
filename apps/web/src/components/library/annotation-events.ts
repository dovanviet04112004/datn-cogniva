/**
 * Annotation event bus — bridge giữa DocPreviewPanel ↔ AnnotationsSection
 * (Phase 4 Step 3, 2026-05-27).
 *
 * Hai component nằm khác parent layout (preview ở grid bên trái, list ở grid
 * bên dưới), không share state nên dùng CustomEvent global trên `window`.
 *
 *   SELECT       : preview phát khi user highlight text → list mở form
 *   LOADED       : list phát sau khi fetch xong → preview render overlay
 *   HOVER        : hover note card hoặc rect overlay → cross-highlight
 *   FOCUS        : click rect overlay → list scroll tới note tương ứng
 */

/** Phase 3: text selection trên PDF → mở form note. */
export const ANNOTATION_SELECT_EVENT = 'cogniva:library:annotation-select';

/** Phase 4: list annotations đã load → preview cache để render overlay. */
export const ANNOTATIONS_LOADED_EVENT = 'cogniva:library:annotations-loaded';

/** Phase 4: hover (preview rect ↔ list card) — broadcast id để bên còn lại highlight. */
export const ANNOTATION_HOVER_EVENT = 'cogniva:library:annotation-hover';

/** Phase 4: click rect overlay → list scroll + flash card tương ứng. */
export const ANNOTATION_FOCUS_EVENT = 'cogniva:library:annotation-focus';

/** Mobile fix: preview thông báo số trang user đang xem được, để annotations
 *  form clamp pageNum input đúng (tránh user tạo note trang vô hình). */
export const ANNOTATION_PREVIEW_LIMIT_EVENT = 'cogniva:library:preview-limit';

export type AnnotationSelectionRect = {
  /** Kích thước page render time (PDF native px) để chuyển sang ratio. */
  pageW: number;
  pageH: number;
  /** Tất cả normalized 0..1 — thuận tiện re-render khi page scale đổi. */
  x: number;
  y: number;
  w: number;
  h: number;
};

export type AnnotationOverlayItem = {
  id: string;
  pageNum: number;
  authorName: string | null;
  note: string;
  selectionRect: AnnotationSelectionRect | null;
};

export type AnnotationSelectDetail = {
  pageNum: number;
  selectedText: string;
  /** Phase 4 Step 3: rect normalized 0..1 — null khi không đo được. */
  selectionRect: AnnotationSelectionRect | null;
};

export type AnnotationsLoadedDetail = {
  items: AnnotationOverlayItem[];
};

export type AnnotationHoverDetail = {
  id: string | null;
  /** Nguồn phát — dùng để consumer skip event của chính nó. */
  source: 'preview' | 'list';
};

export type AnnotationFocusDetail = {
  id: string;
};

export type AnnotationPreviewLimitDetail = {
  /** Tổng số trang viewer đang render được (limit cao nhất khi tạo note). */
  visiblePageCount: number;
  /** Người dùng có quyền xem toàn bộ doc không (PRO/owner/purchased). */
  fullAccess: boolean;
};
