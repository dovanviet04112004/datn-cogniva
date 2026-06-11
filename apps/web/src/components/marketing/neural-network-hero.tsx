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

function HeroFallback() {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <div className="pointer-events-none absolute -left-10 -top-10 h-72 w-72 rounded-full bg-indigo-500/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-10 -right-10 h-72 w-72 rounded-full bg-purple-500/30 blur-3xl" />
      <div className="bg-discovery-500/20 pointer-events-none absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full blur-2xl" />
    </div>
  );
}
