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
