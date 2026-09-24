import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import type { RunUpdateEvent } from '@codesync/shared';
import { failRun, INFRA_ERROR_MESSAGE, processRun, type ProcessRunDeps } from '../src/jobs/process-run';
import type { ClaimedRun, RunStore } from '../src/jobs/run.repository';
import type { ExecutionResult, SandboxRunner } from '../src/sandbox/runner';

const RUN: ClaimedRun = {
  id: 'r1',
  roomId: 'room1',
  userId: 'u1',
  userName: 'Asha',
  language: 'PYTHON',
  code: 'print(1)',
};
const OK: ExecutionResult = { status: 'SUCCESS', stdout: '1\n', stderr: '', exitCode: 0, durationMs: 50 };

function setup(overrides: { runs?: Partial<RunStore>; runner?: SandboxRunner } = {}) {
  const events: RunUpdateEvent[] = [];
  const runs: RunStore = {
    claim: vi.fn(async () => RUN),
    complete: vi.fn(async () => true),
    fail: vi.fn(async () => RUN),
    ...overrides.runs,
  };
  const deps: ProcessRunDeps = {
    runs,
    runner: overrides.runner ?? { run: vi.fn(async () => OK) },
    publish: async (e) => {
      events.push(e);
    },
    log: pino({ level: 'silent' }),
  };
  return { deps, events, runs };
}

describe('processRun', () => {
  it('publishes RUNNING then the final result', async () => {
    const { deps, events, runs } = setup();
    await processRun('r1', deps);
    expect(events.map((e) => e.status)).toEqual(['RUNNING', 'SUCCESS']);
    expect(events[1]).toMatchObject({ roomId: 'room1', userName: 'Asha', stdout: '1\n', exitCode: 0 });
    expect(runs.complete).toHaveBeenCalledWith('r1', OK);
  });

  it('treats user-code errors as a normal result (no throw -> no retry)', async () => {
    const result: ExecutionResult = {
      status: 'ERROR',
      stdout: '',
      stderr: 'boom',
      exitCode: 1,
      durationMs: 5,
    };
    const { deps, events } = setup({ runner: { run: async () => result } });
    await expect(processRun('r1', deps)).resolves.toBeUndefined();
    expect(events.at(-1)?.status).toBe('ERROR');
  });

  it('rethrows infrastructure errors so BullMQ retries the job', async () => {
    const { deps } = setup({
      runner: {
        run: async () => {
          throw new Error('docker daemon unreachable');
        },
      },
    });
    await expect(processRun('r1', deps)).rejects.toThrow('docker daemon unreachable');
  });

  it('skips runs that are already finished (duplicate delivery)', async () => {
    const runner = { run: vi.fn(async () => OK) };
    const { deps, events } = setup({ runs: { claim: async () => null }, runner });
    await processRun('r1', deps);
    expect(runner.run).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('does not publish a result that lost the race to another worker', async () => {
    const { deps, events } = setup({ runs: { complete: async () => false } });
    await processRun('r1', deps);
    expect(events.map((e) => e.status)).toEqual(['RUNNING']);
  });
});

describe('failRun', () => {
  it('marks the run ERROR and tells the room', async () => {
    const { deps, events } = setup();
    await failRun('r1', deps);
    expect(events).toEqual([expect.objectContaining({ status: 'ERROR', stderr: INFRA_ERROR_MESSAGE })]);
  });
});
