/**
 * RedisService — ioredis client dùng chung (session lookup `ba:`, sau này
 * cache/rate-limit). FAIL-OPEN theo chuẩn hệ: Redis chết → trả null, caller
 * tự fallback (vd AuthGuard fallback đọc bảng session).
 */
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    this.client.on('error', () => {
      /* fail-open — lỗi đã được caller xử lý qua getSafe() */
    });
  }

  /** GET fail-open: lỗi/timeout → null thay vì throw. */
  async getSafe(key: string): Promise<string | null> {
    try {
      if (this.client.status === 'wait') await this.client.connect();
      return await this.client.get(key);
    } catch {
      return null;
    }
  }

  /** DEL fail-open: lỗi Redis → bỏ qua (caller không cần biết). */
  async delSafe(key: string): Promise<void> {
    try {
      if (this.client.status === 'wait') await this.client.connect();
      await this.client.del(key);
    } catch {
      /* fail-open */
    }
  }

  async ping(): Promise<boolean> {
    try {
      if (this.client.status === 'wait') await this.client.connect();
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy() {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
