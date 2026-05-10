/**
 * FlashcardForm — form tạo thẻ thủ công (BASIC / CLOZE / IMAGE_OCCLUSION).
 *
 * Render condition theo cardType:
 *   - BASIC: 2 textarea front + back
 *   - CLOZE: 1 textarea với hint syntax `{{c1::keyword}}`
 *   - IMAGE_OCCLUSION: input file → upload → ImageOcclusionEditor
 *
 * Dynamic import Editor để tránh SSR (Konva chỉ chạy client).
 */
'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

import type { Mask } from './image-occlusion-editor';

// Dynamic import để tránh SSR — react-konva yêu cầu document/Image
const ImageOcclusionEditor = dynamic(
  () => import('./image-occlusion-editor').then((m) => m.ImageOcclusionEditor),
  { ssr: false, loading: () => <p className="text-sm text-muted-foreground">Đang tải editor...</p> },
);

type Props = {
  onCreated: () => void;
};

export function FlashcardForm({ onCreated }: Props) {
  const [type, setType] = React.useState<'BASIC' | 'CLOZE' | 'IMAGE_OCCLUSION'>('BASIC');
  const [front, setFront] = React.useState('');
  const [back, setBack] = React.useState('');
  const [imageUrl, setImageUrl] = React.useState<string | null>(null);
  const [imageKey, setImageKey] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/flashcards/upload-image', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      setImageUrl(data.url);
      setImageKey(data.storageKey);
    } catch (err) {
      toast.error('Upload ảnh thất bại: ' + (err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const create = async (overrides?: { front?: string; back?: string }) => {
    const finalFront = overrides?.front ?? front;
    const finalBack = overrides?.back ?? back;
    if (!finalFront || !finalBack) {
      toast.error('Cần đủ front + back');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardType: type, front: finalFront, back: finalBack }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      toast.success('Đã tạo thẻ');
      setFront('');
      setBack('');
      setImageUrl(null);
      setImageKey(null);
      onCreated();
    } catch (err) {
      toast.error('Tạo thẻ thất bại: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const saveOcclusion = (masks: Mask[]) => {
    if (!imageUrl) return;
    create({ front: imageUrl, back: JSON.stringify({ masks }) });
  };

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="space-y-1.5">
        <Label htmlFor="type">Loại thẻ</Label>
        <select
          id="type"
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          <option value="BASIC">BASIC — front/back</option>
          <option value="CLOZE">CLOZE — điền chỗ trống</option>
          <option value="IMAGE_OCCLUSION">IMAGE_OCCLUSION — che vùng trong ảnh</option>
        </select>
      </div>

      {type === 'BASIC' && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="front">Mặt trước (câu hỏi)</Label>
            <textarea
              id="front"
              value={front}
              onChange={(e) => setFront(e.target.value)}
              rows={3}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="back">Mặt sau (đáp án)</Label>
            <textarea
              id="back"
              value={back}
              onChange={(e) => setBack(e.target.value)}
              rows={4}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>
          <Button onClick={() => create()} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Tạo thẻ
          </Button>
        </>
      )}

      {type === 'CLOZE' && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="cloze">Câu cloze</Label>
            <textarea
              id="cloze"
              value={front}
              onChange={(e) => setFront(e.target.value)}
              rows={4}
              placeholder="Thủ đô của {{c1::Việt Nam}} là Hà Nội."
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Bọc keyword bằng <code>{'{{c1::keyword}}'}</code>. Tuỳ chọn hint:{' '}
              <code>{'{{c1::keyword::hint}}'}</code>
            </p>
          </div>
          <Button onClick={() => create({ back: ' ' })} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Tạo thẻ cloze
          </Button>
        </>
      )}

      {type === 'IMAGE_OCCLUSION' && (
        <>
          {!imageUrl && (
            <div className="space-y-2">
              <Label htmlFor="img">Ảnh</Label>
              <input
                id="img"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadImage(f);
                }}
                disabled={uploading}
                className="text-sm"
              />
              {uploading && (
                <p className="flex items-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading...
                </p>
              )}
            </div>
          )}

          {imageUrl && (
            <ImageOcclusionEditor
              imageUrl={imageUrl}
              onSave={saveOcclusion}
              onCancel={() => {
                setImageUrl(null);
                setImageKey(null);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
