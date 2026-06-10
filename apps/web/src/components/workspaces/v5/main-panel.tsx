/**
 * MainPanel — cột giữa V5 workspace notebook.
 *
 * Spec: docs/plans/v5-notebooklm-layout.md §4.2.
 *
 * V8.25 (2026-05-20) **NEW PATTERN**:
 *   - Main panel LUÔN render ChatView. Chat không bị "swap mất" khi user
 *     click recipe nữa.
 *   - Recipes (session/flashcard/quiz/atom-guide/mind-map/briefing) mở
 *     dưới dạng MODAL OVERLAY (Radix Dialog) qua `<RecipeOverlay>` mount
 *     ở workspace-notebook root. Chat vẫn visible khi đóng modal.
 *   - Pattern này giống NotebookLM: chat là center pin, recipes là
 *     overlay focus mode.
 *   - Bài thi giữ riêng pattern Studio sidebar swap (V8.24).
 */
'use client';

import { ChatView } from './views/chat-view';

type Props = {
  workspaceId: string;
  workspaceName: string;
};

export function MainPanel({ workspaceId, workspaceName }: Props) {
  return <ChatView workspaceId={workspaceId} workspaceName={workspaceName} />;
}
