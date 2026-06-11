import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { type RedisOptions } from 'ioredis';
import { redisOptionsFromUrl } from '@cogniva/server-core/redis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(config: ConfigService) {
    const parsed = redisOptionsFromUrl(config.getOrThrow<string>('REDIS_URL'));
    const common: RedisOptions = {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
    };
    this.client =
      typeof parsed === 'string' ? new Redis(parsed, common) : new Redis({ ...parsed, ...common });
    this.client.on('error', () => {});
  }

  async getSafe(key: string): Promise<string | null> {
    try {
      if (this.client.status === 'wait') await this.client.connect();
      return await this.client.get(key);
    } catch {
      return null;
    }
  }

  async delSafe(key: string): Promise<void> {
    try {
      if (this.client.status === 'wait') await this.client.connect();
      await this.client.del(key);
    } catch {}
  }

  async raw(): Promise<Redis | null> {
    try {
      if (this.client.status === 'wait') await this.client.connect();
      return this.client;
    } catch {
      return null;
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
