/**
 * /exams — redirect về /workspaces (Workspace-centric flow).
 *
 * Exams owned scope theo workspace. List qua workspace > Exams tab.
 * Joined exams (do người khác share) hiện tại không có entry sidebar — sẽ
 * surface qua dashboard widget hoặc profile sau. Sub-routes vẫn hoạt động:
 * /exams/[id], /exams/new, /exams/[id]/take/[attemptId], v.v.
 */
import { redirect } from 'next/navigation';

export const runtime = 'nodejs';

export default function ExamsListRedirect() {
  redirect('/workspaces');
}
