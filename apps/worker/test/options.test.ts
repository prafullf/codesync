import { describe, expect, it } from 'vitest';
import { LIMITS } from '@codesync/shared';
import { buildContainerOptions, imageFor, SANDBOX_LABEL } from '../src/sandbox/options';

const opts = (language: 'PYTHON' | 'JAVASCRIPT' | 'CPP') =>
  buildContainerOptions({ language, runId: 'run_1', imagePrefix: 'codesync-sandbox' });

describe('buildContainerOptions (security-critical)', () => {
  it.each(['PYTHON', 'JAVASCRIPT', 'CPP'] as const)('%s: applies every sandbox restriction', (lang) => {
    const o = opts(lang);
    const h = o.HostConfig!;
    expect(o.User).toBe('1000:1000');
    expect(o.NetworkDisabled).toBe(true);
    expect(h.NetworkMode).toBe('none');
    expect(h.Memory).toBe(128 * 1024 * 1024);
    expect(h.MemorySwap).toBe(h.Memory);
    expect(h.NanoCpus).toBe(500_000_000);
    expect(h.PidsLimit).toBe(64);
    expect(h.ReadonlyRootfs).toBe(true);
    expect(h.CapDrop).toEqual(['ALL']);
    expect(h.SecurityOpt).toEqual(['no-new-privileges']);
    expect(h.AutoRemove).toBe(true);
    expect(h.Privileged).toBeUndefined();
    expect(h.Binds).toBeUndefined();
    expect(h.Tmpfs?.['/tmp']).toContain(`size=${LIMITS.SANDBOX_TMPFS_SIZE}`);
    expect(h.Tmpfs?.['/tmp']).toContain('nosuid');
    expect(o.Labels?.[SANDBOX_LABEL]).toBe('true');
  });

  it('code is never part of the command line', () => {
    const o = opts('PYTHON');
    expect(o.Cmd).toEqual(['/runner/run.sh']);
    expect(o.OpenStdin).toBe(true);
    expect(o.StdinOnce).toBe(true);
  });

  it('/tmp is noexec except for C++, which must run its compiled binary', () => {
    expect(opts('PYTHON').HostConfig?.Tmpfs?.['/tmp']).toContain('noexec');
    expect(opts('JAVASCRIPT').HostConfig?.Tmpfs?.['/tmp']).toContain('noexec');
    expect(opts('CPP').HostConfig?.Tmpfs?.['/tmp']).toMatch(/(^|,)exec(,|$)/);
  });

  it('maps languages to runner images', () => {
    expect(imageFor('PYTHON', 'p')).toBe('p-python:latest');
    expect(imageFor('JAVASCRIPT', 'p')).toBe('p-node:latest');
    expect(imageFor('CPP', 'p')).toBe('p-cpp:latest');
  });
});
