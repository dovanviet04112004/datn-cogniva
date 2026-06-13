'use client';

import * as React from 'react';
import { Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

import { UploadWizard } from './upload-wizard';

export function UploadButton({
  label,
  initialCourse = null,
  size,
  variant,
  className,
}: {
  label: string;
  initialCourse?: { id: string; label: string } | null;
  size?: React.ComponentProps<typeof Button>['size'];
  variant?: React.ComponentProps<typeof Button>['variant'];
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size={size} variant={variant} className={cn('gap-1.5', className)}>
          <Upload className="h-3.5 w-3.5" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="text-left">
          <DialogTitle>Tải tài liệu lên kho</DialogTitle>
          <DialogDescription>
            Chia sẻ tài liệu với cộng đồng Cogniva. AI tự embed + tóm tắt khi xử lý xong.
          </DialogDescription>
        </DialogHeader>
        <UploadWizard initialCourse={initialCourse} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
