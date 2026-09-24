import type { Logger } from 'pino';
import type { RunUpdateEvent } from '@codesync/shared';
import type { SandboxRunner } from '../sandbox/runner';
import type { RunStore } from './run.repository';

export interface ProcessRunDeps {
  runs: RunStore;
  runner: SandboxRunner;
  publish: (event: RunUpdateEvent) => Promise<void>;
  log: Logger;
}

export const INFRA_ERROR_MESSAGE = 'Internal execution error. Please try again.';

/**
 * One job = one run. Throws only for infrastructure problems, which is what
 * makes BullMQ retry it; user-code errors are a normal (non-throwing) result.
 */
export async function processRun(runId: string, deps: ProcessRunDeps): Promise<void> {
  const run = await deps.runs.claim(runId);
  if (!run) {
    deps.log.warn({ runId }, 'run already finished or missing; skipping');
    return;
  }
  const base = { runId, roomId: run.roomId, userId: run.userId, userName: run.userName };
  await deps.publish({ ...base, status: 'RUNNING' });

  const result = await deps.runner.run({ runId, language: run.language, code: run.code });

  const saved = await deps.runs.complete(runId, result);
  if (!saved) {
    deps.log.warn({ runId }, 'run was finalised by someone else; not publishing');
    return;
  }
  deps.log.info({ runId, status: result.status, durationMs: result.durationMs }, 'run finished');
  await deps.publish({
    ...base,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
  });
}

/** Called once retries are exhausted: record the failure so the UI isn't stuck on "Running". */
export async function failRun(runId: string, deps: ProcessRunDeps): Promise<void> {
  const run = await deps.runs.fail(runId, INFRA_ERROR_MESSAGE);
  if (!run) return;
  await deps.publish({
    runId,
    roomId: run.roomId,
    userId: run.userId,
    userName: run.userName,
    status: 'ERROR',
    stderr: INFRA_ERROR_MESSAGE,
  });
}
