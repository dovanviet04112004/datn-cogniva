/**
 * MathCanvasDialog — modal cho user vẽ công thức/sơ đồ toán tay → export PNG.
 *
 * Dùng HTML5 Canvas đơn giản: mouse/touch tracking, vẽ stroke đen trên nền
 * trắng. Sau khi vẽ xong → callback nhận File (PNG) để gắn vào composer.
 *
 * Phase 8 v1 chỉ có:
 *   - Vẽ stroke (mouse + touch)
 *   - Clear canvas
 *   - Save → callback File
 *
 * Phase 9+ thêm: undo/redo, stroke width slider, color picker, OCR
 * Mathpix-style → LaTeX (hiện vision LLM tự nhận diện đủ tốt).
 */
'use client';

import * as React from 'react';
import { Eraser, PencilLine, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (file: File) => void;
};

const CANVAS_W = 600;
const CANVAS_H = 320;

export function MathCanvasDialog({ open, onOpenChange, onSave }: Props) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const drawing = React.useRef(false);
  const last = React.useRef<{ x: number; y: number } | null>(null);

  // Reset canvas khi mở
  React.useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, [open]);

  /** Lấy vị trí mouse/touch so với canvas (đã scale). */
  const getPos = (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    let clientX: number;
    let clientY: number;
    if ('touches' in e) {
      const t = e.touches[0] ?? e.changedTouches[0];
      if (!t) return null;
      clientX = t.clientX;
      clientY = t.clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  };

  const start = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    drawing.current = true;
    last.current = getPos(e);
  };

  const move = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing.current) return;
    e.preventDefault();
    const pos = getPos(e);
    const lastPos = last.current;
    if (!pos || !lastPos) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(lastPos.x, lastPos.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    last.current = pos;
  };

  const end = () => {
    drawing.current = false;
    last.current = null;
  };

  const clearCanvas = () => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `math-${Date.now()}.png`, { type: 'image/png' });
      onSave(file);
      onOpenChange(false);
    }, 'image/png');
  };

  if (!open) return null;

  return (
    <div
      role="presentation"
      onClick={() => onOpenChange(false)}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl space-y-3 rounded-lg border bg-popover p-4 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <PencilLine className="h-4 w-4" />
            Vẽ công thức / sơ đồ
          </h3>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded p-1 hover:bg-muted"
            aria-label="Đóng"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          Vẽ công thức bằng chuột hoặc cảm ứng. Khi gửi, AI sẽ đọc ảnh và phản hồi.
        </p>

        <div className="overflow-hidden rounded-md border bg-white">
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            onMouseDown={start}
            onMouseMove={move}
            onMouseUp={end}
            onMouseLeave={end}
            onTouchStart={start}
            onTouchMove={move}
            onTouchEnd={end}
            className="block h-auto w-full cursor-crosshair touch-none"
            style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={clearCanvas}>
            <Eraser className="mr-1 h-3.5 w-3.5" />
            Xóa
          </Button>
          <Button size="sm" onClick={handleSave}>
            Đính kèm
          </Button>
        </div>
      </div>
    </div>
  );
}
