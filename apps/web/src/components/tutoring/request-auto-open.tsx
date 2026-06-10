/**
 * RequestAutoOpen — auto mở RequestDetailModal theo deep-link ?request=<id>.
 *
 * Mount 1 lần trong RequestsTab. Dùng cho các link cũ (mine-tab, concierge, tạo
 * yêu cầu xong…) trỏ /tutoring/requests/[id] nay redirect về
 * /tutoring?tab=requests&request=<id>. Render rỗng nếu không có param.
 */
'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';

import { RequestDetailModal } from './request-detail-modal';

export function RequestAutoOpen() {
  const sp = useSearchParams();
  const [openId, setOpenId] = React.useState<string | null>(null);
  const did = React.useRef(false);

  React.useEffect(() => {
    if (did.current) return;
    const id = sp.get('request');
    if (id) {
      did.current = true;
      setOpenId(id);
    }
  }, [sp]);

  if (!openId) return null;
  return (
    <RequestDetailModal
      requestId={openId}
      open={openId !== null}
      onOpenChange={(o) => !o && setOpenId(null)}
    />
  );
}
