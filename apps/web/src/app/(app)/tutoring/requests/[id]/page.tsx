import { redirect } from 'next/navigation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RequestRedirect({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams({ tab: 'requests', request: id });
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === 'string' && k !== 'tab' && k !== 'request') qs.set(k, v);
  }
  redirect(`/tutoring?${qs.toString()}`);
}
