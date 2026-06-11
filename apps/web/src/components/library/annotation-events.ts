export const ANNOTATION_SELECT_EVENT = 'cogniva:library:annotation-select';

export const ANNOTATIONS_LOADED_EVENT = 'cogniva:library:annotations-loaded';

export const ANNOTATION_HOVER_EVENT = 'cogniva:library:annotation-hover';

export const ANNOTATION_FOCUS_EVENT = 'cogniva:library:annotation-focus';

export const ANNOTATION_PREVIEW_LIMIT_EVENT = 'cogniva:library:preview-limit';

export type AnnotationSelectionRect = {
  pageW: number;
  pageH: number;
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
  selectionRect: AnnotationSelectionRect | null;
};

export type AnnotationsLoadedDetail = {
  items: AnnotationOverlayItem[];
};

export type AnnotationHoverDetail = {
  id: string | null;
  source: 'preview' | 'list';
};

export type AnnotationFocusDetail = {
  id: string;
};

export type AnnotationPreviewLimitDetail = {
  visiblePageCount: number;
  fullAccess: boolean;
};
