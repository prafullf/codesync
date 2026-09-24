import type Docker from 'dockerode';
import { LIMITS, type Language } from '@codesync/shared';
import { BoundedOutput } from './bounded-output';
import { buildContainerOptions } from './options';

export type ExecutionStatus = 'SUCCESS' | 'ERROR' | 'TIMEOUT';

export interface ExecutionResult {
  status: ExecutionStatus;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface SandboxRunner {
  /** Resolves for every outcome of *user* code. Rejects only on infrastructure failure. */
  run(input: { runId: string; language: Language; code: string }): Promise<ExecutionResult>;
}

export interface DockerRunnerOptions {
  imagePrefix: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

/**
 * docker-modem sends the attach options as a JSON request body, and Docker can
 * forward those bytes into the container's stdin ahead of ours (timing-dependent).
 * So the source is framed: run.sh discards everything up to this marker line.
 * Must match sandbox-images/<lang>/run.sh.
 */
export const STDIN_MARKER = '__CODESYNC_SOURCE_BEGIN__';

const SIGKILL_EXIT = 137;
const OUTPUT_DRAIN_MS = 500;

export class DockerSandboxRunner implements SandboxRunner {
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;

  constructor(
    private readonly docker: Docker,
    private readonly opts: DockerRunnerOptions,
  ) {
    this.timeoutMs = opts.timeoutMs ?? LIMITS.RUN_TIMEOUT_MS;
    this.maxOutputBytes = opts.maxOutputBytes ?? LIMITS.MAX_OUTPUT_BYTES;
  }

  async run(input: { runId: string; language: Language; code: string }): Promise<ExecutionResult> {
    // A fresh container for every run: nothing leaks between runs or users.
    const container = await this.docker.createContainer(
      buildContainerOptions({ language: input.language, runId: input.runId, imagePrefix: this.opts.imagePrefix }),
    );

    const stdout = new BoundedOutput(this.maxOutputBytes);
    const stderr = new BoundedOutput(this.maxOutputBytes);
    let timer: NodeJS.Timeout | undefined;

    try {
      // Attach before start so no output is missed and stdin is ready.
      const stream = await container.attach({
        stream: true,
        stdin: true,
        stdout: true,
        stderr: true,
        hijack: true,
      });
      const outputDone = new Promise<void>((resolve) => {
        stream.once('end', resolve);
        stream.once('close', resolve);
        stream.once('error', () => resolve());
      });
      container.modem.demuxStream(stream, stdout.writable(), stderr.writable());

      // Subscribe to the exit before starting (AutoRemove may delete the container right after).
      const exited = container.wait({ condition: 'next-exit' }) as Promise<{ StatusCode: number }>;

      await container.start();
      const startedAt = performance.now();
      // Write the framed source to stdin, then close stdin (see STDIN_MARKER).
      stream.end(`\n${STDIN_MARKER}\n${input.code}`);

      let timedOut = false;
      timer = setTimeout(() => {
        timedOut = true;
        container.kill({ signal: 'SIGKILL' }).catch(() => undefined);
      }, this.timeoutMs);

      const { StatusCode } = await exited;
      clearTimeout(timer);
      const durationMs = Math.round(performance.now() - startedAt);
      await Promise.race([outputDone, delay(OUTPUT_DRAIN_MS)]);

      if (timedOut) {
        return {
          status: 'TIMEOUT',
          stdout: stdout.toString(),
          stderr: `${stderr.toString()}\n[killed: exceeded ${this.timeoutMs / 1000}s time limit]`.trimStart(),
          exitCode: StatusCode,
          durationMs,
        };
      }

      let err = stderr.toString();
      if (StatusCode === SIGKILL_EXIT) {
        err += `\n[killed: likely exceeded the ${LIMITS.SANDBOX_MEMORY_BYTES / 1024 / 1024} MB memory limit]`;
      }
      return {
        status: StatusCode === 0 ? 'SUCCESS' : 'ERROR',
        stdout: stdout.toString(),
        stderr: err,
        exitCode: StatusCode,
        durationMs,
      };
    } catch (err) {
      clearTimeout(timer);
      await container.remove({ force: true }).catch(() => undefined);
      throw err;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
