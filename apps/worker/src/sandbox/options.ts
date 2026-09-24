import type { ContainerCreateOptions } from 'dockerode';
import { LIMITS, type Language } from '@codesync/shared';

export const SANDBOX_LABEL = 'codesync.sandbox';

const IMAGE_SUFFIX: Record<Language, string> = {
  PYTHON: 'python',
  JAVASCRIPT: 'node',
  CPP: 'cpp',
};

export function imageFor(language: Language, prefix: string): string {
  return `${prefix}-${IMAGE_SUFFIX[language]}:latest`;
}

/**
 * The security boundary of the whole product, as one pure function so it can
 * be unit-tested. Every flag here maps to a rule in the spec (§7).
 */
export function buildContainerOptions(input: {
  language: Language;
  runId: string;
  imagePrefix: string;
}): ContainerCreateOptions {
  // Only C++ has to execute a file it wrote (the compiled binary).
  const tmpExec = input.language === 'CPP' ? 'exec' : 'noexec';

  return {
    Image: imageFor(input.language, input.imagePrefix),
    Cmd: ['/runner/run.sh'],
    User: '1000:1000', // never root inside the container
    WorkingDir: '/tmp',
    Env: ['HOME=/tmp', 'TMPDIR=/tmp'],
    // Code is streamed in over stdin, then stdin is closed.
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    OpenStdin: true,
    StdinOnce: true,
    Tty: false,
    NetworkDisabled: true,
    Labels: { [SANDBOX_LABEL]: 'true', 'codesync.run-id': input.runId },
    HostConfig: {
      NetworkMode: 'none', // no network at all: no exfiltration, no crypto-mining pools
      Memory: LIMITS.SANDBOX_MEMORY_BYTES,
      MemorySwap: LIMITS.SANDBOX_MEMORY_BYTES, // == Memory -> no swap
      NanoCpus: LIMITS.SANDBOX_NANO_CPUS, // 0.5 CPU
      PidsLimit: LIMITS.SANDBOX_PIDS_LIMIT, // fork-bomb protection
      ReadonlyRootfs: true,
      Tmpfs: { '/tmp': `rw,${tmpExec},nosuid,nodev,size=${LIMITS.SANDBOX_TMPFS_SIZE},mode=1777` },
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      Ulimits: [{ Name: 'nofile', Soft: 256, Hard: 256 }],
      // Output is read through the attach stream; don't also write it to the host disk.
      LogConfig: { Type: 'none', Config: {} },
      AutoRemove: true,
    },
  };
}
