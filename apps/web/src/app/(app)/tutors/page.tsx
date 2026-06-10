/**
 * /tutors — legacy entry, redirect tới /tutoring?tab=tutors.
 *
 * Tutoring hub đã consolidate vào 1 trang duy nhất /tutoring với 3 tab
 * (tutors / requests / mine). URL /tutors này giữ lại để backward-compat
 * cho các link cũ — qua đó preserve subject/level/modality filter trong query.
 */
import { redirect } from 'next/navigation';

export const runtime = 'nodejs';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function TutorsRedirectPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams({ tab: 'tutors' });
  for (const key of ['subject', 'level', 'modality', 'minRate', 'maxRate']) {
    const v = sp[key];
    if (typeof v === 'string') params.set(key, v);
  }
  redirect(`/tutoring?${params.toString()}`);
}
