/**
 * JoinByCode — input field cho user nhập 6-char code và join room.
 * POST /api/rooms/join → redirect /rooms/{id}/lobby.
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

export function JoinByCode() {
  const router = useRouter();
  const [code, setCode] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim().length < 4) return;
    setLoading(true);
    try {
      const res = await fetch('/api/rooms/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim().toUpperCase() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Mã không hợp lệ');
      }
      const { roomId } = await res.json();
      router.push(`/rooms/${roomId}/lobby`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="Nhập mã (6 ký tự)"
        maxLength={10}
        autoCapitalize="characters"
        className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm font-mono uppercase tracking-wider"
      />
      <Button type="submit" disabled={loading || code.trim().length < 4} size="sm">
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
      </Button>
    </form>
  );
}
