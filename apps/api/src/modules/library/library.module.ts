import { Module } from '@nestjs/common';

import { OutcomeTrackerService } from './outcome-tracker.service';

/**
 * LibraryModule — Wave 3 STUB: mới có OutcomeTrackerService cho quiz/exam
 * submit ghi outcome (Pillar #5). Toàn bộ routes /api/library/** (discovery,
 * import, quality, karma, ...) port ở Wave 5 mới lấp controllers + services
 * còn lại. CHƯA mount vào app.module — module nào cần thì imports trực tiếp.
 */
@Module({
  providers: [OutcomeTrackerService],
  exports: [OutcomeTrackerService],
})
export class LibraryModule {}
