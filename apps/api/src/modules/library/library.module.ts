import { Module } from '@nestjs/common';

import { OutcomeTrackerService } from './outcome-tracker.service';

@Module({
  providers: [OutcomeTrackerService],
  exports: [OutcomeTrackerService],
})
export class LibraryModule {}
