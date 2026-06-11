import { redirect } from 'next/navigation';

export const runtime = 'nodejs';

export default function RoomsListRedirect() {
  redirect('/groups');
}
