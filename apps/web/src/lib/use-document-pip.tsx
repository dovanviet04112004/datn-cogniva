/**
 * useDocumentPiP — mở cửa sổ Document Picture-in-Picture (như Google Meet).
 *
 * Document PiP API (Chromium 116+) cho phép mở 1 cửa sổ NHỎ luôn-trên-cùng, nổi
 * RA NGOÀI tab/trình duyệt/ứng dụng khác, chứa DOM tuỳ ý (video + nút). Khác
 * <video> PiP thường (chỉ 1 video) — cái này render được cả control bar.
 *
 * Lưu ý:
 *  - Cần user gesture để mở (click).
 *  - Cửa sổ PiP KHÔNG kế thừa CSS → phải copy <style>/<link> sang head + class
 *    dark-mode trên <html>.
 *  - Chỉ Chromium hỗ trợ → feature-detect, fallback thanh nổi trong tab.
 */
'use client';

import * as React from 'react';

type DocPiP = {
  requestWindow: (opts?: { width?: number; height?: number }) => Promise<Window>;
  window: Window | null;
};

function getDocPiP(): DocPiP | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { documentPictureInPicture?: DocPiP }).documentPictureInPicture ?? null;
}

/** Copy mọi stylesheet (style + link) sang cửa sổ PiP + đồng bộ class dark-mode. */
function syncStyles(target: Window) {
  // Dark/light class trên <html> (next-themes class-based).
  target.document.documentElement.className = document.documentElement.className;
  target.document.body.className = document.body.className;
  for (const node of Array.from(
    document.querySelectorAll('style, link[rel="stylesheet"]'),
  )) {
    target.document.head.appendChild(node.cloneNode(true));
  }
  // adoptedStyleSheets (nếu có) — gán trực tiếp.
  try {
    const src = (document as unknown as { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets;
    if (src && src.length) {
      (target.document as unknown as { adoptedStyleSheets: CSSStyleSheet[] }).adoptedStyleSheets = src;
    }
  } catch {
    /* ignore */
  }
}

export function useDocumentPiP() {
  const [pipWindow, setPipWindow] = React.useState<Window | null>(null);
  const supported = !!getDocPiP();

  const open = React.useCallback(
    async (opts?: { width?: number; height?: number }) => {
      const dpip = getDocPiP();
      if (!dpip) return null;
      if (pipWindow) return pipWindow;
      try {
        const w = await dpip.requestWindow({
          width: opts?.width ?? 380,
          height: opts?.height ?? 300,
        });
        syncStyles(w);
        w.document.body.style.margin = '0';
        const onHide = () => setPipWindow(null);
        w.addEventListener('pagehide', onHide);
        setPipWindow(w);
        return w;
      } catch {
        return null;
      }
    },
    [pipWindow],
  );

  const close = React.useCallback(() => {
    try {
      pipWindow?.close();
    } catch {
      /* ignore */
    }
    setPipWindow(null);
  }, [pipWindow]);

  // Dọn khi unmount.
  React.useEffect(() => {
    return () => {
      try {
        pipWindow?.close();
      } catch {
        /* ignore */
      }
    };
  }, [pipWindow]);

  return { pipWindow, supported, open, close };
}
