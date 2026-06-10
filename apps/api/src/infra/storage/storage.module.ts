import { Global, Module } from '@nestjs/common';

import { StorageService } from './storage.service';

/** @Global — mọi domain module inject StorageService không cần import lại. */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
