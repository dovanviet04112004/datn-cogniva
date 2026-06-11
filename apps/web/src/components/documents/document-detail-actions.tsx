'use client';

import Link from 'next/link';
import { MessageSquare } from 'lucide-react';

import { Button } from '@/components/ui/button';

type Props = {
  workspaceId?: string | null;
};

export function DocumentDetailActions({ workspaceId }: Props) {
  if (!workspaceId) return null;

  return (
    <Button variant="outline" size="sm" asChild>
      <Link href={`/workspaces/${workspaceId}?view=chat`}>
        <MessageSquare className="mr-1 h-3.5 w-3.5" />
        Mở trong workspace
      </Link>
    </Button>
  );
}
