/**
 * MaintenanceBannerClient — render + dismiss state cho banner maintenance.
 *
 * Dismiss state lưu sessionStorage. Banner text thay đổi → key cache khác →
 * lại hiện. Đơn giản hash text để dùng làm key version.
 */
'use client';

import * as React from 'react';
import { Hammer, X } from 'lucide-react';

const STORAGE_KEY_PREFIX = 'cogniva.maintenance.dismissed:';

export function MaintenanceBannerClient({
  banner,
  dismissible,
}: {
  banner: string;
  dismissible: boolean;
}) {
  const [dismissed, setDismissed] = React.useState(false);
  // Hash đơn giản cho key — thay đổi banner text sẽ tạo key mới, dismiss reset.
  const key = STORAGE_KEY_PREFIX + djb2(banner);

  React.useEffect(() => {
    if (!dismissible) return;
    try {
      if (sessionStorage.getItem(key) === '1') setDismissed(true);
    } catch {
      /* ignore */
    }
  }, [key, dismissible]);

  if (dismissed) return null;

  return (
    <div
      role="alert"
      className="flex items-start gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2.5 text-[12px] text-warning"
    >
      <Hammer className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
      <p className="flex-1">{banner}</p>
      {dismissible && (
        <button
          onClick={() => {
            try {
              sessionStorage.setItem(key, '1');
            } catch {
              /* ignore */
            }
            setDismissed(true);
          }}
          className="shrink-0 rounded p-0.5 text-warning transition-colors hover:bg-warning/20"
          aria-label="Đóng banner"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function djb2(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}
