/**
 * /quiz — redirect về /workspaces (Workspace-centric flow).
 *
 * Quizzes giờ scope theo workspace. List/Generate qua workspace > Quizzes tab.
 * Sub-routes vẫn hoạt động: /quiz/[id]/attempt (làm bài), /quiz/[id]/results.
 */
import { redirect } from 'next/navigation';

export const runtime = 'nodejs';

export default function QuizListRedirect() {
  redirect('/workspaces');
}
