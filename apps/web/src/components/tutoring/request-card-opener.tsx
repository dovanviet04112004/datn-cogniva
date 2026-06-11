'use client';

import * as React from 'react';

import { RequestDetailModal } from './request-detail-modal';

export function RequestCardOpener({
  requestId,
  className,
  children,
}: {
  requestId: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {children}
      </button>
      <RequestDetailModal requestId={open ? requestId : null} open={open} onOpenChange={setOpen} />
    </>
  );
}
