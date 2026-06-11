import { redirect } from 'next/navigation';

export const runtime = 'nodejs';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function TutorsRedirectPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const params = new URLSearchParams({ tab: 'tutors' });
  for (const key of ['subject', 'level', 'modality', 'minRate', 'maxRate']) {
    const v = sp[key];
    if (typeof v === 'string') params.set(key, v);
  }
  redirect(`/tutoring?${params.toString()}`);
}
