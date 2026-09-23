import { LIMITS, type CreateRunBody, type Run } from '@codesync/shared';
import { errors } from '../../lib/errors';
import type { EventBus } from '../../lib/event-bus';
import type { RoomService } from '../rooms/rooms.service';
import type { RunQueue } from './run.queue';
import type { RunRepository, RunWithUser } from './runs.repository';

export function toRunDto(run: RunWithUser): Run {
  return {
    id: run.id,
    roomId: run.roomId,
    userId: run.userId,
    userName: run.user.name,
    language: run.language,
    code: run.code,
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    exitCode: run.exitCode,
    durationMs: run.durationMs,
    createdAt: run.createdAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

export class RunService {
  constructor(
    private readonly runs: RunRepository,
    private readonly rooms: RoomService,
    private readonly queue: RunQueue,
    private readonly events: EventBus,
    private readonly maxQueueLength: number,
  ) {}

  async create(userId: string, roomId: string, body: CreateRunBody): Promise<{ runId: string }> {
    await this.rooms.requireRole(userId, roomId, 'EDITOR');

    const bytes = Buffer.byteLength(body.code, 'utf8');
    if (bytes > LIMITS.MAX_CODE_BYTES) {
      throw errors.payloadTooLarge(`Code is ${bytes} bytes; the limit is ${LIMITS.MAX_CODE_BYTES} bytes`);
    }

    // Queue guard: shed load early instead of letting the backlog grow forever.
    if ((await this.queue.backlog()) >= this.maxQueueLength) {
      throw errors.queueFull();
    }

    const run = await this.runs.create({ roomId, userId, language: body.language, code: body.code });
    try {
      await this.queue.enqueue(run.id);
    } catch (err) {
      await this.runs.markFailed(run.id, 'Could not queue this run. Please try again.');
      throw err;
    }

    await this.events.publishRunUpdate({
      runId: run.id,
      roomId,
      userId,
      userName: run.user.name,
      status: 'QUEUED',
    });
    return { runId: run.id };
  }

  async list(userId: string, roomId: string, limit: number): Promise<Run[]> {
    await this.rooms.requireRole(userId, roomId, 'VIEWER');
    const runs = await this.runs.listByRoom(roomId, limit);
    return runs.map(toRunDto);
  }

  async get(userId: string, runId: string): Promise<Run> {
    const run = await this.runs.findById(runId);
    if (!run) throw errors.notFound('Run not found');
    await this.rooms.requireRole(userId, run.roomId, 'VIEWER');
    return toRunDto(run);
  }
}
