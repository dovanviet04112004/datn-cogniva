'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function JoinForm({ initialCode = '', error }: { initialCode?: string; error?: string }) {
  const router = useRouter();
  const [code, setCode] = React.useState(initialCode);
  const [submitting, setSubmitting] = React.useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = code.trim().toUpperCase();
    if (cleaned.length < 4) {
      toast.error('Code phải có ít nhất 4 ký tự');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/exams/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: cleaned }),
      });
      if (res.status === 401) {
        const returnTo = encodeURIComponent(`/join?code=${cleaned}`);
        router.push(`/sign-in?redirect=${returnTo}`);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { examId: string };
      router.push(`/exams/${data.examId}`);
    } catch (err) {
      toast.error('Vào exam thất bại: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-md p-6">
      <Card className="p-6">
        <h1 className="text-2xl font-semibold">Tham gia bài thi</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Nhập 6 ký tự code do giáo viên cung cấp.
        </p>
        {error && (
          <div className="border-destructive/30 bg-destructive/5 text-destructive mt-4 rounded-md border p-3 text-sm">
            {error}
          </div>
        )}
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code">Mã bài thi</Label>
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCDEF"
              maxLength={12}
              autoFocus
              className="text-center font-mono text-2xl tracking-widest"
            />
          </div>
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? 'Đang vào...' : 'Vào bài thi'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
