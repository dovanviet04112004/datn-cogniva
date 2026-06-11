'use client';

import * as React from 'react';

type DocPiP = {
  requestWindow: (opts?: { width?: number; height?: number }) => Promise<Window>;
  window: Window | null;
};

function getDocPiP(): DocPiP | null {
  if (typeof window === 'undefined') return null;
  return (
    (window as unknown as { documentPictureInPicture?: DocPiP }).documentPictureInPicture ?? null
  );
}

function syncStyles(target: Window) {
  target.document.documentElement.className = document.documentElement.className;
  target.document.body.className = document.body.className;
  for (const node of Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))) {
    target.document.head.appendChild(node.cloneNode(true));
  }
  try {
    const src = (document as unknown as { adoptedStyleSheets?: CSSStyleSheet[] })
      .adoptedStyleSheets;
    if (src && src.length) {
      (target.document as unknown as { adoptedStyleSheets: CSSStyleSheet[] }).adoptedStyleSheets =
        src;
    }
  } catch {}
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
    } catch {}
    setPipWindow(null);
  }, [pipWindow]);

  React.useEffect(() => {
    return () => {
      try {
        pipWindow?.close();
      } catch {}
    };
  }, [pipWindow]);

  return { pipWindow, supported, open, close };
}
