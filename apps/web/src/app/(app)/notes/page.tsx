import { redirect } from 'next/navigation';

export const runtime = 'nodejs';

export default function NotesListRedirect() {
  redirect('/workspaces');
}
