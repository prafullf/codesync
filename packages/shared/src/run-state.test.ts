import { describe, expect, it } from 'vitest';
import { allowedSourceStatuses, canTransition, isTerminal, shouldApplyRunUpdate } from './run-state';

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

describe('shouldApplyRunUpdate (client-side ordering)', () => {
  it('applies the first update and forward progress', () => {
    expect(shouldApplyRunUpdate(undefined, 'QUEUED')).toBe(true);
    expect(shouldApplyRunUpdate('QUEUED', 'RUNNING')).toBe(true);
    expect(shouldApplyRunUpdate('RUNNING', 'SUCCESS')).toBe(true);
  });

  it('ignores a late QUEUED after RUNNING or a finished result', () => {
    expect(shouldApplyRunUpdate('RUNNING', 'QUEUED')).toBe(false);
    expect(shouldApplyRunUpdate('SUCCESS', 'QUEUED')).toBe(false);
    expect(shouldApplyRunUpdate('TIMEOUT', 'RUNNING')).toBe(false);
  });

  it('lets the same final status refresh details, but never flips it', () => {
    expect(shouldApplyRunUpdate('SUCCESS', 'SUCCESS')).toBe(true);
    expect(shouldApplyRunUpdate('SUCCESS', 'ERROR')).toBe(false);
  });
});
