/**
 * ImageOcclusionViewer — hiển thị ảnh + masks trong review.
 *
 * Front: tất cả masks đang che (rectangles solid)
 * Back: masks trong → reveal (chỉ vẽ border) cho user thấy nội dung
 *
 * Dùng <img> + absolute div overlay thay vì canvas vì:
 *   - Đơn giản, không cần useEffect/canvas resize
 *   - Image responsive với layout thẻ
 */
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
      {/* Mask overlay — scale theo ảnh real-time qua percentage */}
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
                  ? 'border-2 border-primary bg-primary/0'
                  : 'bg-primary/85 backdrop-blur-sm',
              )}
            />
          );
        })}
    </div>
  );
}
