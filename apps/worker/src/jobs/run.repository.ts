import type { PrismaClient, RunStatus } from '@codesync/db';
import { allowedSourceStatuses } from '@codesync/shared';
import type { ExecutionResult } from '../sandbox/runner';

export interface ClaimedRun {
  id: string;
  roomId: string;
  userId: string;
  userName: string;
  language: 'PYTHON' | 'JAVASCRIPT' | 'CPP';
  code: string;
}

export interface RunStore {
  claim(runId: string): Promise<ClaimedRun | null>;
  complete(runId: string, result: ExecutionResult): Promise<boolean>;
  fail(runId: string, message: string): Promise<ClaimedRun | null>;
}

/**
 * Every write is a conditional UPDATE ... WHERE status IN (legal sources),
 * so the state machine is enforced by the database even with many workers.
 */
export class WorkerRunRepository implements RunStore {
  constructor(private readonly prisma: PrismaClient) {}

  /** QUEUED/RUNNING -> RUNNING. Returns null if the run is already finished (or gone). */
  async claim(runId: string): Promise<ClaimedRun | null> {
    const { count } = await this.prisma.run.updateMany({
      where: { id: runId, status: { in: allowedSourceStatuses('RUNNING') as RunStatus[] } },
      data: { status: 'RUNNING' },
    });
    if (count === 0) return null;
    const run = await this.prisma.run.findUnique({
      where: { id: runId },
      include: { user: { select: { name: true } } },
    });
    if (!run) return null;
    return {
      id: run.id,
      roomId: run.roomId,
      userId: run.userId,
      userName: run.user.name,
      language: run.language,
      code: run.code,
    };
  }

  async complete(runId: string, result: ExecutionResult): Promise<boolean> {
    const { count } = await this.prisma.run.updateMany({
      where: { id: runId, status: { in: allowedSourceStatuses(result.status) as RunStatus[] } },
      data: {
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        finishedAt: new Date(),
      },
    });
    return count === 1;
  }

  async fail(runId: string, message: string): Promise<ClaimedRun | null> {
    const { count } = await this.prisma.run.updateMany({
      where: { id: runId, status: { in: allowedSourceStatuses('ERROR') as RunStatus[] } },
      data: { status: 'ERROR', stderr: message, finishedAt: new Date() },
    });
    if (count === 0) return null;
    const run = await this.prisma.run.findUnique({
      where: { id: runId },
      include: { user: { select: { name: true } } },
    });
    return run
      ? {
          id: run.id,
          roomId: run.roomId,
          userId: run.userId,
          userName: run.user.name,
          language: run.language,
          code: run.code,
        }
      : null;
  }
}
