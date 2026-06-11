'use client';

import * as React from 'react';
import { Calendar } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  BookingDialog,
  type AvailabilitySlot,
  type TutorSubjectMini,
} from '@/components/tutoring/booking-dialog';
import { cn } from '@/lib/utils';

export function BookButton({
  tutorId,
  tutorName,
  hourlyRateVnd,
  subjects,
  availability,
  instantBookEnabled = false,
  trialEligible = false,
  variant = 'default',
}: {
  tutorId: string;
  tutorName: string;
  hourlyRateVnd: number;
  subjects: TutorSubjectMini[];
  availability: AvailabilitySlot[];
  instantBookEnabled?: boolean;
  trialEligible?: boolean;
  variant?: 'default' | 'large';
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        className={cn('gap-1.5', variant === 'large' && 'px-5 py-2.5 text-sm')}
      >
        <Calendar className="h-4 w-4" />
        {instantBookEnabled ? 'Đặt ngay' : 'Đặt buổi học'}
      </Button>
      {open && (
        <BookingDialog
          tutorId={tutorId}
          tutorName={tutorName}
          hourlyRateVnd={hourlyRateVnd}
          subjects={subjects}
          availability={availability}
          instantBookEnabled={instantBookEnabled}
          trialEligible={trialEligible}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}
