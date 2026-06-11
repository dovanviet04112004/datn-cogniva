'use client';

import * as React from 'react';
import { Heart } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function FavoriteButton({
  tutorId,
  initialFavorited = false,
}: {
  tutorId: string;
  initialFavorited?: boolean;
}) {
  const [favorited, setFavorited] = React.useState(initialFavorited);
  const [busy, setBusy] = React.useState(false);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    const prev = favorited;
    setFavorited(!prev);
    try {
      const res = await fetch(`/api/tutors/${tutorId}/favorite`, { method: 'POST' });
      if (!res.ok) throw new Error('Toggle lỗi');
      const data = (await res.json()) as { favorited: boolean };
      setFavorited(data.favorited);
      toast.success(data.favorited ? 'Đã thêm yêu thích' : 'Đã bỏ yêu thích');
    } catch (err) {
      setFavorited(prev);
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      onClick={toggle}
      disabled={busy}
      variant="outline"
      size="sm"
      className={cn(
        'gap-1.5',
        favorited && 'border-rose-500/40 bg-rose-500/5 text-rose-600 hover:bg-rose-500/10',
      )}
      aria-label={favorited ? 'Bỏ yêu thích' : 'Thêm yêu thích'}
    >
      <Heart className={cn('h-4 w-4', favorited && 'fill-current')} />
      {favorited ? 'Đã ♥' : 'Yêu thích'}
    </Button>
  );
}
