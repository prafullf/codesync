import Docker from 'dockerode';
import { beforeAll, describe, expect, it } from 'vitest';
import { DockerSandboxRunner } from '../src/sandbox/runner';
import { TRUNCATION_NOTICE } from '../src/sandbox/bounded-output';

/**
 * Real Docker, real images (build them with `pnpm build:sandbox`).
 * Set SKIP_DOCKER_TESTS=1 to skip on machines without Docker.
 */
const skip = process.env.SKIP_DOCKER_TESTS === '1';
const docker = new Docker();
const runner = new DockerSandboxRunner(docker, {
  imagePrefix: process.env.SANDBOX_IMAGE_PREFIX ?? 'codesync-sandbox',
});
let n = 0;
const run = (language: 'PYTHON' | 'JAVASCRIPT' | 'CPP', code: string) =>
  runner.run({ runId: `test-${Date.now()}-${++n}`, language, code });

describe.skipIf(skip)('DockerSandboxRunner (real Docker)', () => {
  beforeAll(async () => {
    await docker.ping();
  });

  it('runs Python hello world', async () => {
    const r = await run('PYTHON', 'print("hello py")');
    expect(r).toMatchObject({ status: 'SUCCESS', stdout: 'hello py\n', exitCode: 0 });
  });

  it('runs JavaScript hello world', async () => {
    const r = await run('JAVASCRIPT', 'console.log("hello js")');
    expect(r).toMatchObject({ status: 'SUCCESS', stdout: 'hello js\n', exitCode: 0 });
  });

  it('compiles and runs C++ hello world', async () => {
    const r = await run('CPP', '#include <iostream>\nint main(){ std::cout << "hello cpp" << std::endl; }');
    expect(r).toMatchObject({ status: 'SUCCESS', stdout: 'hello cpp\n', exitCode: 0 });
  });

  it('reports compile errors as ERROR', async () => {
    const r = await run('CPP', 'int main() { return x; }');
    expect(r.status).toBe('ERROR');
    expect(r.stderr).toContain('error');
  });

  it('captures stderr and non-zero exit codes', async () => {
    const r = await run('PYTHON', 'import sys\nprint("oops", file=sys.stderr)\nsys.exit(3)');
    expect(r).toMatchObject({ status: 'ERROR', exitCode: 3 });
    expect(r.stderr).toContain('oops');
  });

  it('kills infinite loops after ~5 s -> TIMEOUT', async () => {
    const r = await run('PYTHON', 'while True: pass');
    expect(r.status).toBe('TIMEOUT');
    expect(r.durationMs).toBeGreaterThanOrEqual(4_900);
    expect(r.durationMs).toBeLessThan(7_000);
  });

  it('has no network access', async () => {
    const r = await run(
      'PYTHON',
      // An IP, so the result doesn't depend on DNS behaviour.
      'import urllib.request\nurllib.request.urlopen("http://1.1.1.1", timeout=3)',
    );
    expect(r.status).toBe('ERROR');
    expect(r.stderr).toContain('Network unreachable');
  });

  it('survives a fork bomb (pids limit)', async () => {
    const r = await run('PYTHON', 'import os\nwhile True:\n    os.fork()');
    expect(['ERROR', 'TIMEOUT']).toContain(r.status);
    // The host (and this worker) are still fine: the next run works.
    const after = await run('PYTHON', 'print("still alive")');
    expect(after.stdout).toBe('still alive\n');
  });

  it('runs as a non-root user with a read-only root filesystem', async () => {
    const r = await run(
      'PYTHON',
      'import os\nprint(os.getuid())\ntry:\n    open("/etc/pwned", "w")\nexcept OSError as e:\n    print("readonly")',
    );
    expect(r.stdout).toBe('1000\nreadonly\n');
  });

  it('truncates huge output to 64 KB', async () => {
    const r = await run('PYTHON', 'print("x" * 200_000)');
    expect(r.stdout.endsWith(TRUNCATION_NOTICE)).toBe(true);
    expect(Buffer.byteLength(r.stdout)).toBeLessThanOrEqual(64 * 1024 + TRUNCATION_NOTICE.length);
  });

  it('enforces the memory limit', async () => {
    const r = await run('PYTHON', 'x = bytearray(400 * 1024 * 1024)\nprint("allocated")');
    expect(r.status).toBe('ERROR');
    expect(r.stdout).not.toContain('allocated');
  });

  it('delivers the source byte-for-byte (nothing prepended to stdin)', async () => {
    // Regression: docker-modem used to leak the attach options into stdin.
    for (let i = 0; i < 5; i++) {
      const r = await run('PYTHON', 'import sys\nsys.exit(3)');
      expect(r.exitCode).toBe(3);
    }
  });

  it('treats code as data, never as shell', async () => {
    const r = await run('PYTHON', 'print("$(whoami) `id` ; rm -rf /")');
    expect(r.stdout).toBe('$(whoami) `id` ; rm -rf /\n');
  });

  it('leaves no containers behind', async () => {
    await run('PYTHON', 'print(1)');
    await new Promise((res) => setTimeout(res, 500));
    const left = await docker.listContainers({ all: true, filters: { label: ['codesync.sandbox=true'] } });
    expect(left).toHaveLength(0);
  });
});
