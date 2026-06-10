/**
 * PrismaService — client DB duy nhất của API, kết nối Neon pooled
 * (?pgbouncer=true trong DATABASE_URL). Lifecycle gắn với Nest để đóng
 * connection sạch khi SIGTERM.
 */
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
