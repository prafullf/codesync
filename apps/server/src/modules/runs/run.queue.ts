import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { RUN_QUEUE_NAME, type RunJobData } from '@codesync/shared';

export interface RunQueue {
  enqueue(runId: string): Promise<void>;
  /** Jobs waiting to be picked up (used by the queue guard). */
  backlog(): Promise<number>;
  close(): Promise<void>;
}

export class BullRunQueue implements RunQueue {
  private readonly queue: Queue<RunJobData>;

  constructor(connection: Redis) {
    this.queue = new Queue<RunJobData>(RUN_QUEUE_NAME, { connection });
  }

  async enqueue(runId: string): Promise<void> {
    await this.queue.add(
      'run',
      { runId },
      {
        jobId: runId, // idempotent: the same run can never be queued twice
        // 1 retry, only reached when the worker *throws* (Docker/DB down).
        // User-code failures are normal results and never throw.
        attempts: 2,
        backoff: { type: 'fixed', delay: 1_000 },
        // History lives in Postgres, so keep Redis small.
        removeOnComplete: true,
        removeOnFail: { count: 100 },
      },
    );
  }

  async backlog(): Promise<number> {
    const counts = await this.queue.getJobCounts('waiting', 'delayed', 'prioritized');
    return (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.prioritized ?? 0);
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
