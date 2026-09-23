import { Redis } from 'ioredis';

export function createRedis(url: string): Redis {
  // maxRetriesPerRequest: null is required by BullMQ for blocking connections.
  return new Redis(url, { maxRetriesPerRequest: null });
}
