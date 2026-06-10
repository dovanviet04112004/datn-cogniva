/**
 * DensityContext — V2 G2 (2026-05-21).
 *
 * Quản lý density mode cho text channel message list. 2 mode:
 *   - 'cozy'    (default) — avatar 40px, gap 4px (current UX, ~Discord cozy)
 *   - 'compact' (Discord-style) — avatar 28px, gap 1px, consecutive group
 *                 nhiều hơn (10min thay vì 5min), font 13.5px
 *
 * Persist qua cookie `cogniva.chat-density` (1 năm). Đọc cookie ở mount,
 * apply class lên message list root → CSS-only theme swap, no re-mount.
 *
 * Toggle UI: settings dropdown trên channel header hoặc preferences user.
 */
'use client';

import * as React from 'react';

export type Density = 'cozy' | 'compact';

type Ctx = {
  density: Density;
  setDensity: (d: Density) => void;
};

const DEFAULT: Density = 'cozy';
const COOKIE_NAME = 'cogniva.chat-density';

const Context = React.createContext<Ctx>({
  density: DEFAULT,
  setDensity: () => undefined,
});

export function useDensity(): Ctx {
  return React.useContext(Context);
}

/**
 * Chế độ 'compact' đã GỠ (render rối + người dùng không cần) → luôn dùng 'cozy'.
 * Giữ provider/hook để các consumer hiện có (message-item, text-channel) không
 * phải đổi; chỉ ép giá trị cozy + xoá cookie compact cũ nếu user từng bật.
 */
export function DensityProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    try {
      if (document.cookie.includes(`${COOKIE_NAME}=compact`)) {
        document.cookie = `${COOKIE_NAME}=cozy; path=/; max-age=0`;
      }
    } catch {
      /* ignore */
    }
  }, []);

  const value = React.useMemo<Ctx>(() => ({ density: 'cozy', setDensity: () => undefined }), []);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
