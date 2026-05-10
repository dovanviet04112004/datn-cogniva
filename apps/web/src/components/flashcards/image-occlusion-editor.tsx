/**
 * ImageOcclusionEditor — vẽ rectangle masks trên ảnh bằng react-konva.
 *
 * UX:
 *   1. User upload ảnh (input file ngoài) → component nhận imageUrl
 *   2. Click & drag để vẽ rectangle che — nhả chuột tạo 1 mask
 *   3. Click 1 mask đã có → delete
 *   4. Bấm "Lưu" → callback onSave({ imageUrl, masks })
 *
 * Note: react-konva chỉ chạy client-side (Konva dùng <canvas>) — wrap dynamic
 * import phía page để tránh SSR hydration issue.
 */
'use client';

import * as React from 'react';
import { Stage, Layer, Image as KonvaImage, Rect } from 'react-konva';
import useImage from 'use-image';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

export type Mask = { x: number; y: number; width: number; height: number };

type Props = {
  imageUrl: string;
  initialMasks?: Mask[];
  onSave: (masks: Mask[]) => void;
  onCancel?: () => void;
};

const STAGE_MAX_WIDTH = 720;

export function ImageOcclusionEditor({ imageUrl, initialMasks = [], onSave, onCancel }: Props) {
  const [image] = useImage(imageUrl);
  const [masks, setMasks] = React.useState<Mask[]>(initialMasks);
  const [drawing, setDrawing] = React.useState<Mask | null>(null);

  // Scale image fit STAGE_MAX_WIDTH để không overflow card
  const scale = image ? Math.min(1, STAGE_MAX_WIDTH / image.width) : 1;
  const stageWidth = image ? image.width * scale : STAGE_MAX_WIDTH;
  const stageHeight = image ? image.height * scale : 400;

  const onMouseDown = (e: { target: { getStage: () => { getPointerPosition: () => { x: number; y: number } | null } | null } }) => {
    const stage = e.target.getStage();
    if (!stage) return;
    const point = stage.getPointerPosition();
    if (!point) return;
    setDrawing({ x: point.x / scale, y: point.y / scale, width: 0, height: 0 });
  };

  const onMouseMove = (e: { target: { getStage: () => { getPointerPosition: () => { x: number; y: number } | null } | null } }) => {
    if (!drawing) return;
    const stage = e.target.getStage();
    if (!stage) return;
    const point = stage.getPointerPosition();
    if (!point) return;
    setDrawing({
      ...drawing,
      width: point.x / scale - drawing.x,
      height: point.y / scale - drawing.y,
    });
  };

  const onMouseUp = () => {
    if (!drawing) return;
    // Bỏ rectangle quá nhỏ (click không drag)
    if (Math.abs(drawing.width) > 10 && Math.abs(drawing.height) > 10) {
      // Normalize negative width/height (drag ngược)
      const normalized: Mask = {
        x: drawing.width < 0 ? drawing.x + drawing.width : drawing.x,
        y: drawing.height < 0 ? drawing.y + drawing.height : drawing.y,
        width: Math.abs(drawing.width),
        height: Math.abs(drawing.height),
      };
      setMasks([...masks, normalized]);
    }
    setDrawing(null);
  };

  const removeMask = (idx: number) => {
    setMasks(masks.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-muted/40 p-2">
        <Stage
          width={stageWidth}
          height={stageHeight}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          style={{ cursor: 'crosshair' }}
        >
          <Layer>
            {image && <KonvaImage image={image} scaleX={scale} scaleY={scale} />}
            {masks.map((m, i) => (
              <Rect
                key={i}
                x={m.x * scale}
                y={m.y * scale}
                width={m.width * scale}
                height={m.height * scale}
                fill="rgba(99, 102, 241, 0.85)"
                stroke="rgb(79, 70, 229)"
                strokeWidth={2}
                onClick={() => removeMask(i)}
                onTap={() => removeMask(i)}
              />
            ))}
            {drawing && (
              <Rect
                x={drawing.x * scale}
                y={drawing.y * scale}
                width={drawing.width * scale}
                height={drawing.height * scale}
                fill="rgba(99, 102, 241, 0.5)"
                stroke="rgb(79, 70, 229)"
                strokeWidth={1}
                dash={[4, 4]}
              />
            )}
          </Layer>
        </Stage>
      </div>

      <p className="text-xs text-muted-foreground">
        Kéo chuột để vẽ vùng che. Click vào mask đã có để xoá. Đã có {masks.length} mask.
      </p>

      <div className="flex gap-2">
        <Button onClick={() => onSave(masks)} disabled={masks.length === 0}>
          Lưu thẻ
        </Button>
        {onCancel && (
          <Button variant="outline" onClick={onCancel}>
            Huỷ
          </Button>
        )}
        {masks.length > 0 && (
          <Button variant="ghost" onClick={() => setMasks([])} className="ml-auto">
            <Trash2 className="mr-1 h-4 w-4" />
            Xoá hết
          </Button>
        )}
      </div>
    </div>
  );
}
