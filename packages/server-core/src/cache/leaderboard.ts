import { getRedis, zRevRangeWithScores } from '../redis';
import { logger } from '../logger';

import { LB_XP } from './keys';

export async function lbIncr(userId: string, delta: number): Promise<void> {
  try {
    await getRedis().zincrby(LB_XP, delta, userId);
  } catch (err) {
    logger.warn('lb.incr_error', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function lbTop(n: number): Promise<Array<{ userId: string; xp: number }> | null> {
  try {
    const flat = await zRevRangeWithScores(LB_XP, n);
    if (flat.length === 0) return null;
    const out: Array<{ userId: string; xp: number }> = [];
    for (let i = 0; i < flat.length; i += 2) {
      out.push({ userId: flat[i]!, xp: Number(flat[i + 1]) });
    }
    return out;
  } catch (err) {
    logger.warn('lb.top_error', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

const LUA_REBUILD =
  "redis.call('DEL', KEYS[1]) for i=1,#ARGV,2 do redis.call('ZADD', KEYS[1], ARGV[i], ARGV[i+1]) end return 1";

export async function lbBackfill(rows: Array<{ userId: string; xp: number }>): Promise<void> {
  try {
    const redis = getRedis();
    if (rows.length === 0) {
      await redis.del(LB_XP);
      return;
    }
    const args: string[] = [];
    for (const r of rows) {
      args.push(String(r.xp), r.userId);
    }
    await redis.eval(LUA_REBUILD, [LB_XP], args);
  } catch (err) {
    logger.warn('lb.backfill_error', { error: err instanceof Error ? err.message : String(err) });
  }
}
