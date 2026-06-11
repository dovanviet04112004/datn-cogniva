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
  const key = STORAGE_KEY_PREFIX + djb2(banner);

  React.useEffect(() => {
    if (!dismissible) return;
    try {
      if (sessionStorage.getItem(key) === '1') setDismissed(true);
    } catch {}
  }, [key, dismissible]);

  if (dismissed) return null;

  return (
    <div
      role="alert"
      className="border-warning/30 bg-warning/10 text-warning flex items-start gap-2 border-b px-4 py-2.5 text-[12px]"
    >
      <Hammer className="text-warning mt-0.5 h-3.5 w-3.5 shrink-0" />
      <p className="flex-1">{banner}</p>
      {dismissible && (
        <button
          onClick={() => {
            try {
              sessionStorage.setItem(key, '1');
            } catch {}
            setDismissed(true);
          }}
          className="text-warning hover:bg-warning/20 shrink-0 rounded p-0.5 transition-colors"
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
