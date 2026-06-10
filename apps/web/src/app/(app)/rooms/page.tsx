/**
 * /rooms — DEPRECATED. Voice rooms giờ là channels bên trong Study Groups.
 *
 * Redirect → /groups để user vào hub mới. Sub-routes /rooms/[id]/lobby
 * + /rooms/[id]/recordings vẫn giữ (legacy data, không có entry sidebar).
 */
import { redirect } from 'next/navigation';

export const runtime = 'nodejs';

export default function RoomsListRedirect() {
  redirect('/groups');
}
