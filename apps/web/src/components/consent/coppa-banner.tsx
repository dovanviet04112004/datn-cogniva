/**
 * CoppaBanner — banner top trong app shell khi user PENDING/REJECTED consent.
 *
 * Plan v2 §3.7.2.
 *
 * 2 trạng thái:
 *   - PENDING : warning amber + nút "Gửi lại email" + link /coppa-pending
 *   - REJECTED: error red + "Liên hệ support" + sign out
 *
 * Hide hoàn toàn khi VERIFIED/NOT_REQUIRED — không thêm clutter UI.
 *
 * Auto-poll status mỗi 60s — UI tự dismiss khi parent verify.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertCircle, Mail, X } from 'lucide-react';

type ConsentStatus = {
  status: string;
  isLimited: boolean;
  parentEmail: string | null;
  parentalConsentAt: string | null;
  age: number | null;
};

export function CoppaBanner() {
  const [state, setState] = React.useState<ConsentStatus | null>(null);
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => {
    const fetchStatus = () => {
      fetch('/api/account/parental-consent')
        .then((r) => (r.ok ? r.json() : null))
        .then((d: ConsentStatus | null) => d && setState(d))
        .catch(() => {});
    };
    fetchStatus();
    // Poll mỗi 60s — parent verify thì banner auto-disappear
    const id = setInterval(fetchStatus, 60_000);
    return () => clearInterval(id);
  }, []);

  if (!state || !state.isLimited || dismissed) return null;

  if (state.status === 'REJECTED') {
    return (
      <div
        role="alert"
        className="flex items-center justify-between gap-2 border-b border-red-700/40 bg-red-600/95 px-4 py-2 text-xs text-white"
      >
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            <strong>Account đã bị từ chối</strong> bởi cha mẹ. Liên hệ{' '}
            <a href="mailto:support@cogniva.app" className="underline">
              support@cogniva.app
            </a>{' '}
            nếu cần khôi phục.
          </span>
        </div>
      </div>
    );
  }

  // PENDING
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-2 border-b border-amber-600/40 bg-amber-500/95 px-4 py-2 text-xs text-white"
    >
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4 shrink-0" />
        <span>
          Account <strong>limited</strong> — đợi cha mẹ ({state.parentEmail}) đồng ý.{' '}
          <Link href="/coppa-pending" className="underline">
            Xem chi tiết hoặc gửi lại email
          </Link>
        </span>
      </div>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Tạm ẩn banner"
        className="rounded p-0.5 hover:bg-white/20"
        title="Tạm ẩn (trang sẽ show lại khi reload)"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
