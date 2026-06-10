/**
 * /messages — landing khi user vào hub DM.
 *
 * Desktop: render empty splash ở pane phải (ThreadList đã có ở layout aside).
 * Mobile: render ThreadList full-screen (layout aside hidden ở md-).
 */
'use client';

import { MessageSquare } from 'lucide-react';

import { ThreadList } from '@/components/dm/thread-list';

export default function MessagesLandingPage() {
  return (
    <>
      {/* Mobile: full-screen list */}
      <div className="flex h-full flex-col md:hidden">
        <ThreadList />
      </div>

      {/* Desktop: empty splash với hint */}
      <div className="hidden h-full flex-col items-center justify-center px-8 text-center md:flex">
        <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
          <MessageSquare className="h-7 w-7" strokeWidth={1.75} />
          <span
            aria-hidden
            className="pointer-events-none absolute -inset-3 rounded-2xl bg-primary/10 blur-xl"
          />
        </div>
        <h2 className="mt-5 text-lg font-semibold tracking-tight">
          Chọn hội thoại
        </h2>
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
          Chọn 1 tin nhắn từ danh sách bên trái để bắt đầu chat. Hoặc click
          avatar member trong study group để mở DM mới.
        </p>
      </div>
    </>
  );
}
