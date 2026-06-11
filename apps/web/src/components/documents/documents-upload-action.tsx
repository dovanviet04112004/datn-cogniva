'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { UploadDocumentDialog } from './upload-document-dialog';

export function DocumentsUploadAction() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (searchParams.get('upload') !== '1') return;
    setOpen(true);
    const next = new URLSearchParams(searchParams.toString());
    next.delete('upload');
    const qs = next.toString();
    router.replace(qs ? `/documents?${qs}` : '/documents', { scroll: false });
  }, [searchParams, router]);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Upload
      </Button>
      <UploadDocumentDialog
        open={open}
        onOpenChange={setOpen}
        onUploaded={() => router.refresh()}
      />
    </>
  );
}
