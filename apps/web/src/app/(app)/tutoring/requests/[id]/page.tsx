/**
 * /tutoring/requests/[id] — đã gom vào modal ở hub.
 *
 * Trang đầy đủ bị bỏ: xem/ứng tuyển/duyệt làm trong RequestDetailModal ở
 * /tutoring tab "Yêu cầu học". Route này chỉ redirect deep-link cũ (mine-tab,
 * concierge, tạo yêu cầu xong…) về hub + auto mở modal.
 */
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
