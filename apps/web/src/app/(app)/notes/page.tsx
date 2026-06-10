/**
 * /notes — redirect về /workspaces (Workspace-centric flow).
 *
 * Note giờ luôn thuộc workspace (hoặc "Personal" workspace ảo). Page list
 * này không còn cần thiết — user tạo note qua workspace detail Notes tab.
 * Page editor `/notes/[id]` giữ nguyên hoạt động (linked từ Notes tab).
 */
import { redirect } from 'next/navigation';

export const runtime = 'nodejs';

export default function NotesListRedirect() {
  redirect('/workspaces');
}
