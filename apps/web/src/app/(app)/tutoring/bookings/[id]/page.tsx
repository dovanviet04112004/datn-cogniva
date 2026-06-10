/**
 * /tutoring/bookings/[id] — đã gom vào modal ở hub.
 *
 * Trang đầy đủ bị bỏ: mọi thao tác (info · phòng học · thanh toán · đánh giá ·
 * xác nhận/huỷ/hoàn thành) làm trong BookingDetailModal ở /tutoring tab "Đơn
 * học". Route này chỉ redirect deep-link (return thanh toán, iCal, calendar,
 * tạo booking…) về hub + auto mở modal, GIỮ NGUYÊN query để luồng thanh toán
 * (?stub / ?paid) vẫn chạy trong modal.
 */
import { redirect } from 'next/navigation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function BookingRedirect({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams({ tab: 'orders', booking: id });
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === 'string') qs.set(k, v);
  }
  redirect(`/tutoring?${qs.toString()}`);
}
