/**
 * Wrapper mỏng quanh next-themes ThemeProvider — Client Component vì
 * next-themes phải truy cập `localStorage` và `matchMedia` của browser.
 *
 * Lý do tách file riêng thay vì dùng trực tiếp trong layout:
 *  - Layout là Server Component, không thể import trực tiếp Client Component
 *    có "use client" như NextThemesProvider; phải qua một wrapper.
 *  - Để dễ thay thư viện theme sau này (ví dụ chuyển sang shadcn theme
 *    provider mới) chỉ cần đổi 1 chỗ.
 */
'use client';

import * as React from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
