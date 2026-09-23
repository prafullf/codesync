import type { Redis } from 'ioredis';
import { RUN_RESULTS_CHANNEL, type RoomUpdatedPayload, type RunUpdateEvent } from '@codesync/shared';

export const ROOM_UPDATES_CHANNEL = 'room:updates';

/**
 * Events go through Redis pub/sub (not straight to Socket.IO) so that every
 * API instance receives them and can forward to its own connected sockets.
 */
export class EventBus {
  constructor(private readonly redis: Redis) {}

  async publishRunUpdate(event: RunUpdateEvent): Promise<void> {
    await this.redis.publish(RUN_RESULTS_CHANNEL, JSON.stringify(event));
  }

  async publishRoomUpdate(event: RoomUpdatedPayload): Promise<void> {
    await this.redis.publish(ROOM_UPDATES_CHANNEL, JSON.stringify(event));
  }
}
