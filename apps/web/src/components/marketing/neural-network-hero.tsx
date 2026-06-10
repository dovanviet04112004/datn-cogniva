/**
 * NeuralNetworkHero — wrapper dynamic import cho NeuralNetworkScene.
 *
 * Three.js + react-three-fiber nặng (~80KB gzip), KHÔNG cần ở SSR. Dynamic
 * import với `ssr: false` để:
 *   1. Loại Three.js khỏi server bundle.
 *   2. Tránh hydration mismatch (Canvas chỉ render client-side).
 *   3. Hiển thị fallback gradient mesh tĩnh trong khi tải scene.
 *
 * Fallback đẹp + light-weight: SVG gradient mesh + blob blur. User thấy ngay
 * lập tức, scene 3D load xong fade in mượt.
 */
'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';

const NeuralNetworkScene = dynamic(
  () => import('./neural-network-scene').then((m) => m.NeuralNetworkScene),
  {
    ssr: false,
    loading: () => <HeroFallback />,
  },
);

export function NeuralNetworkHero({ className }: { className?: string }) {
  return (
    <div className={className}>
      <NeuralNetworkScene className="h-full w-full" />
    </div>
  );
}

/**
 * Fallback static — gradient mesh CSS thuần.
 * Hiện ngay khi page load, trước khi 3D scene ready.
 */
function HeroFallback() {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <div className="pointer-events-none absolute -left-10 -top-10 h-72 w-72 rounded-full bg-indigo-500/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-10 -right-10 h-72 w-72 rounded-full bg-purple-500/30 blur-3xl" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-discovery-500/20 blur-2xl" />
    </div>
  );
}
