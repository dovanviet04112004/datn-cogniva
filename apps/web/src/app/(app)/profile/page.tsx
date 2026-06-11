import { redirect } from 'next/navigation';

export default function ProfileSelfPage() {
  redirect('/settings?tab=profile');
}
