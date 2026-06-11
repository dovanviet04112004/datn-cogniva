'use client';

import * as React from 'react';

import type { Mask } from './image-occlusion-editor';
import { cn } from '@/lib/utils';

type Props = {
  imageUrl: string;
  masks: Mask[];
  revealed: boolean;
};

export function ImageOcclusionViewer({ imageUrl, masks, revealed }: Props) {
  const [naturalSize, setNaturalSize] = React.useState<{ w: number; h: number } | null>(null);

  return (
    <div className="relative inline-block max-w-full">
      <img
        src={imageUrl}
        alt="Card image"
        className="block max-w-full rounded-md border"
        onLoad={(e) => {
          const img = e.currentTarget;
          setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
        }}
      />
      {naturalSize &&
        masks.map((m, i) => {
          const style: React.CSSProperties = {
            position: 'absolute',
            left: `${(m.x / naturalSize.w) * 100}%`,
            top: `${(m.y / naturalSize.h) * 100}%`,
            width: `${(m.width / naturalSize.w) * 100}%`,
            height: `${(m.height / naturalSize.h) * 100}%`,
          };
          return (
            <div
              key={i}
              style={style}
              className={cn(
                'rounded transition-all',
                revealed
                  ? 'border-primary bg-primary/0 border-2'
                  : 'bg-primary/85 backdrop-blur-sm',
              )}
            />
          );
        })}
    </div>
  );
}
