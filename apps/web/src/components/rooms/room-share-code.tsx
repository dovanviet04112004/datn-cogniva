/**
 * RoomShareCode — hiển thị joinCode + nút copy link mời người khác.
 * Dùng ở lobby + có thể tái dùng trong room sidebar (Phase 14).
 */
'use client';

import { Check, Copy } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type Props = {
  roomId: string;
  joinCode: string;
};

export function RoomShareCode({ roomId, joinCode }: Props) {
  const [copied, setCopied] = React.useState<'code' | 'link' | null>(null);

  const copy = async (kind: 'code' | 'link') => {
    try {
      const text = kind === 'code'
        ? joinCode
        : `${window.location.origin}/rooms/${roomId}/lobby`;
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      toast.success(kind === 'code' ? 'Đã copy mã' : 'Đã copy link');
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error('Trình duyệt chặn clipboard — copy thủ công nhé');
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 py-3">
        <p className="text-sm font-medium">Mời người khác:</p>
        <button
          onClick={() => copy('code')}
          className="flex items-center gap-1.5 rounded-md border bg-muted px-3 py-1 font-mono text-sm tracking-wider transition-colors hover:bg-muted/70"
          aria-label="Copy mã"
        >
          {joinCode}
          {copied === 'code'
            ? <Check className="h-3.5 w-3.5 text-green-600" />
            : <Copy className="h-3.5 w-3.5" />}
        </button>
        <Button variant="outline" size="sm" onClick={() => copy('link')}>
          {copied === 'link'
            ? <Check className="mr-1 h-3.5 w-3.5 text-green-600" />
            : <Copy className="mr-1 h-3.5 w-3.5" />}
          Copy link
        </Button>
      </CardContent>
    </Card>
  );
}
