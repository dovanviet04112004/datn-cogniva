/**
 * CustomStatusDialog — V2 G3.7 (2026-05-21).
 *
 * Modal đặt custom status text + emoji + auto-clear timer.
 *
 * Spec: docs/plans/study-group-v2.md §G3.
 *
 * Layout:
 *   - Input emoji (single char) + status text (max 128 chars)
 *   - Preset quick-status row (4 templates): "Đang học", "Đang họp", "Bận", "Đi vắng"
 *   - Dropdown expiry: 30min / 1h / 4h / hôm nay / 1 tuần / không xoá
 *   - Footer: Lưu + Xoá status
 */
'use client';

import * as React from 'react';
import { Check, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiSend } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ComboSelect } from '@/components/ui/combo-select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { EmojiPicker } from '@/components/groups/emoji-picker';

const PRESETS = [
  { emoji: '📚', text: 'Đang học' },
  { emoji: '💼', text: 'Đang họp' },
  { emoji: '🚫', text: 'Bận, đừng làm phiền' },
  { emoji: '🏖️', text: 'Đi vắng' },
];

const EXPIRY_OPTIONS: { label: string; sec: number | null }[] = [
  { label: '30 phút', sec: 30 * 60 },
  { label: '1 giờ', sec: 60 * 60 },
  { label: '4 giờ', sec: 4 * 60 * 60 },
  { label: 'Hôm nay', sec: 24 * 60 * 60 },
  { label: '1 tuần', sec: 7 * 24 * 60 * 60 },
  { label: 'Không tự xoá', sec: null },
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CustomStatusDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [emoji, setEmoji] = React.useState('');
  const [text, setText] = React.useState('');
  const [expiresInSec, setExpiresInSec] = React.useState<number | null>(60 * 60);
  const [saving, setSaving] = React.useState(false);
  const [clearing, setClearing] = React.useState(false);
  const [emojiOpen, setEmojiOpen] = React.useState(false);

  // Hydrate từ server khi mở (key dùng chung với UserMenu).
  const { data: statusData } = useQuery({
    queryKey: qk.userStatus(),
    queryFn: () =>
      apiGet<{ statusText?: string | null; statusEmoji?: string | null }>(
        '/api/user/status',
      ),
    enabled: open,
  });
  React.useEffect(() => {
    if (open && statusData) {
      setEmoji(statusData.statusEmoji ?? '');
      setText(statusData.statusText ?? '');
    }
  }, [open, statusData]);

  const save = async () => {
    setSaving(true);
    try {
      await apiSend('/api/user/status', 'PUT', {
        statusText: text.trim() || null,
        statusEmoji: emoji || null,
        expiresInSec: text.trim() || emoji ? expiresInSec : null,
      });
      toast.success('Đã đặt trạng thái tuỳ chỉnh');
      void qc.invalidateQueries({ queryKey: qk.userStatus() });
      onOpenChange(false);
    } catch (err) {
      toast.error('Lưu lỗi: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setClearing(true);
    try {
      await apiSend('/api/user/status', 'PUT', {
        statusText: null,
        statusEmoji: null,
        expiresInSec: null,
      });
      toast.success('Đã xoá trạng thái');
      void qc.invalidateQueries({ queryKey: qk.userStatus() });
      onOpenChange(false);
    } catch (err) {
      toast.error('Xoá lỗi: ' + (err as Error).message);
    } finally {
      setClearing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Đặt trạng thái tuỳ chỉnh</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Emoji + text input row */}
          <div className="space-y-1.5">
            <Label htmlFor="cstatus-text">Bạn đang làm gì?</Label>
            <div className="relative flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEmojiOpen((s) => !s)}
                aria-label="Chọn emoji"
                title="Chọn emoji"
                className="inline-flex h-9 w-10 shrink-0 items-center justify-center rounded-md border bg-background text-lg transition-colors hover:bg-muted"
              >
                {emoji || '🙂'}
              </button>
              <Input
                id="cstatus-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Vd: Đang ôn thi cuối kỳ"
                maxLength={128}
                className="flex-1"
              />
              {emojiOpen && (
                <div className="absolute left-0 top-11 z-10">
                  <EmojiPicker
                    onSelect={(e) => {
                      setEmoji(e);
                      setEmojiOpen(false);
                    }}
                    onClose={() => setEmojiOpen(false)}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Preset row */}
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Mẫu nhanh
            </Label>
            <div className="grid grid-cols-2 gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.text}
                  type="button"
                  onClick={() => {
                    setEmoji(p.emoji);
                    setText(p.text);
                  }}
                  className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted"
                >
                  <span className="text-base">{p.emoji}</span>
                  <span className="truncate">{p.text}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Expiry dropdown */}
          <div className="space-y-1.5">
            <Label htmlFor="cstatus-expiry">Tự xoá sau</Label>
            {/* ComboSelect: value-type number|null → string ở UI, parse lại khi onChange.
                Lưu ý: '' là option THẬT ("Không tự xoá" = sec null), không phải placeholder. */}
            <ComboSelect
              id="cstatus-expiry"
              value={expiresInSec === null ? '' : String(expiresInSec)}
              onChange={(v) => setExpiresInSec(v === '' ? null : Number(v))}
              options={EXPIRY_OPTIONS.map((opt) => ({
                value: opt.sec === null ? '' : String(opt.sec),
                label: opt.label,
              }))}
              className="w-full"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={clear}
            disabled={clearing || saving}
            className="mr-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            {clearing ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="mr-1 h-3.5 w-3.5" />
            )}
            Xoá status
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Huỷ
          </Button>
          <Button onClick={save} disabled={saving || clearing}>
            {saving ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="mr-1 h-3.5 w-3.5" />
            )}
            Lưu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
