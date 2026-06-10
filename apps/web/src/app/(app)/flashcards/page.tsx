/**
 * /flashcards — redirect về /workspaces (Workspace-centric flow).
 *
 * Phase Workspace-centric: flashcards luôn thuộc workspace. Page list cũ
 * không còn cần — user vào workspace > Flashcards tab để xem + generate.
 * Review queue cross-workspace vẫn ở `/flashcards/review` (gọi từ workspace
 * tab "Ôn ngay").
 *
 * Giữ route để không break bookmark cũ + redirect.
 */
import { redirect } from 'next/navigation';

export const runtime = 'nodejs';

export default function FlashcardsListRedirect() {
  redirect('/workspaces');
}
