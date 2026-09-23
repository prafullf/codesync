import { describe, expect, it } from 'vitest';
import { allowedSourceStatuses, canTransition, isTerminal } from './run-state';

describe('run state machine', () => {
  it('allows the happy path', () => {
    expect(canTransition('QUEUED', 'RUNNING')).toBe(true);
    expect(canTransition('RUNNING', 'SUCCESS')).toBe(true);
    expect(canTransition('RUNNING', 'TIMEOUT')).toBe(true);
    expect(canTransition('RUNNING', 'ERROR')).toBe(true);
  });

  it('allows RUNNING -> RUNNING so a stalled job can be retried by another worker', () => {
    expect(canTransition('RUNNING', 'RUNNING')).toBe(true);
  });

  it('never leaves a terminal state', () => {
    for (const terminal of ['SUCCESS', 'ERROR', 'TIMEOUT'] as const) {
      expect(isTerminal(terminal)).toBe(true);
      expect(canTransition(terminal, 'RUNNING')).toBe(false);
      expect(canTransition(terminal, 'QUEUED')).toBe(false);
    }
  });

  it('cannot finish a run that never started', () => {
    expect(canTransition('QUEUED', 'SUCCESS')).toBe(false);
    expect(canTransition('QUEUED', 'TIMEOUT')).toBe(false);
  });

  it('lists legal source statuses', () => {
    expect(allowedSourceStatuses('RUNNING').sort()).toEqual(['QUEUED', 'RUNNING']);
    expect(allowedSourceStatuses('SUCCESS')).toEqual(['RUNNING']);
    expect(allowedSourceStatuses('QUEUED')).toEqual([]);
  });
});
