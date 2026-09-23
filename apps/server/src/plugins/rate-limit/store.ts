import type { Redis } from 'ioredis';

export interface RateLimitResult {
  allowed: boolean;
  /** Requests still allowed in the current window. */
  remaining: number;
  /** When denied: ms until the oldest request leaves the window. */
  retryAfterMs: number;
}

/**
 * Sliding-window-log limiter: remember the timestamp of every allowed request
 * in the last `windowMs`; allow a new one only if fewer than `limit` remain.
 * Unlike a fixed window, a burst at 0:59 + 1:00 cannot double the limit.
 */
export interface RateLimitStore {
  hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

/**
 * Atomic in Redis (one Lua script = no race between "count" and "add"),
 * and uses Redis' clock so several API instances agree on "now".
 */
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local member = ARGV[3]
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)
if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)
  return {1, limit - count - 1, 0}
end
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local retry = tonumber(oldest[2]) + window - now
if retry < 1 then retry = 1 end
return {0, 0, retry}
`;

export class RedisRateLimitStore implements RateLimitStore {
  private counter = 0;

  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'ratelimit:',
  ) {}

  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    // Unique member so two requests in the same millisecond are both counted.
    const member = `${process.pid}:${Date.now()}:${++this.counter}:${Math.random()}`;
    const raw = (await this.redis.eval(
      SLIDING_WINDOW_LUA,
      1,
      this.prefix + key,
      windowMs,
      limit,
      member,
    )) as [number, number, number];
    return { allowed: raw[0] === 1, remaining: raw[1], retryAfterMs: raw[2] };
  }
}

/** Same algorithm in memory. Used by unit tests and handy for single-node setups. */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => t > now - windowMs);
    if (recent.length < limit) {
      recent.push(now);
      this.hits.set(key, recent);
      return { allowed: true, remaining: limit - recent.length, retryAfterMs: 0 };
    }
    this.hits.set(key, recent);
    const oldest = recent[0] ?? now;
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(1, oldest + windowMs - now) };
  }
}
