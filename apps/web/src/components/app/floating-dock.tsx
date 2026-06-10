/**
 * FloatingDock — 1 hàng chứa MỌI widget nổi góc dưới phải (cửa sổ chat DM +
 * mini-player voice), để chúng KHÔNG đè nhau.
 *
 * Cơ chế: provider render 1 container `flex flex-row-reverse items-end` cố định
 * ở góc dưới phải. Các widget portal CON của chúng vào đây → flexbox tự xếp
 * cạnh nhau; cái nào tắt thì cái còn lại tự dồn về sát góc (reflow). Không cần
 * tính toạ độ thủ công.
 *
 * Widget (ChatDock, FloatingVoicePlayer) lấy host qua useFloatingDockHost() rồi
 * createPortal vào. Nếu host chưa sẵn → tự render fixed như cũ (fallback).
 */
'use client';

import * as React from 'react';

const FloatingDockContext = React.createContext<HTMLElement | null>(null);

export function FloatingDockProvider({ children }: { children: React.ReactNode }) {
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  return (
    <FloatingDockContext.Provider value={host}>
      {children}
      <div
        ref={setHost}
        className="pointer-events-none fixed bottom-3 right-4 z-40 flex flex-row-reverse items-end gap-3"
      />
    </FloatingDockContext.Provider>
  );
}

/** Element host để portal widget vào (null nếu provider chưa mount). */
export function useFloatingDockHost(): HTMLElement | null {
  return React.useContext(FloatingDockContext);
}
