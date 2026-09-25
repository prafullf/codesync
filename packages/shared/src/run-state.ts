import type { RunStatus } from './constants';

/**
 * Run lifecycle:
 *
 *   QUEUED ──► RUNNING ──► SUCCESS | ERROR | TIMEOUT
 *     │           │
 *     │           └──► RUNNING   (job re-picked after a worker crash)
 *     └──► ERROR                 (infrastructure failure before it started)
 *
 * Terminal states never change again, so a late/duplicate message cannot
 * overwrite a finished result.
 */
const TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  QUEUED: ['RUNNING', 'ERROR'],
  RUNNING: ['RUNNING', 'SUCCESS', 'ERROR', 'TIMEOUT'],
  SUCCESS: [],
  ERROR: [],
  TIMEOUT: [],
};

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ['SUCCESS', 'ERROR', 'TIMEOUT'];

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Statuses a run may be in for a transition *to* `to` to be legal. */
export function allowedSourceStatuses(to: RunStatus): RunStatus[] {
  return (Object.keys(TRANSITIONS) as RunStatus[]).filter((from) => canTransition(from, to));
}

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.includes(status);
}

const PROGRESS: Record<RunStatus, number> = { QUEUED: 0, RUNNING: 1, SUCCESS: 2, ERROR: 2, TIMEOUT: 2 };

/**
 * Updates can arrive out of order on the client (e.g. the 202 response for a
 * run lands after the worker's RUNNING/SUCCESS socket event). A run must never
 * move backwards, and a finished run only accepts the same final status again
 * (e.g. the full row from history filling in stdout).
 */
export function shouldApplyRunUpdate(current: RunStatus | undefined, next: RunStatus): boolean {
  if (!current) return true;
  if (isTerminal(current)) return next === current;
  return PROGRESS[next] >= PROGRESS[current];
}
