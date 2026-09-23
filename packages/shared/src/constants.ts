export const LANGUAGES = ['PYTHON', 'JAVASCRIPT', 'CPP'] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<Language, string> = {
  PYTHON: 'Python 3.12',
  JAVASCRIPT: 'JavaScript (Node 20)',
  CPP: 'C++ (GCC 13)',
};

/** Monaco editor language ids. */
export const MONACO_LANGUAGE: Record<Language, string> = {
  PYTHON: 'python',
  JAVASCRIPT: 'javascript',
  CPP: 'cpp',
};

/** Starter code inserted into a brand-new room's document. */
export const STARTER_CODE: Record<Language, string> = {
  PYTHON: 'print("Hello from CodeSync!")\n',
  JAVASCRIPT: 'console.log("Hello from CodeSync!");\n',
  CPP: '#include <iostream>\n\nint main() {\n  std::cout << "Hello from CodeSync!" << std::endl;\n  return 0;\n}\n',
};

export const ROLES = ['OWNER', 'EDITOR', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

export const RUN_STATUSES = ['QUEUED', 'RUNNING', 'SUCCESS', 'ERROR', 'TIMEOUT'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const LIMITS = {
  /** Max source code size accepted by the API (bytes). Larger -> 413. */
  MAX_CODE_BYTES: 50 * 1024,
  /** stdout / stderr are each truncated to this many bytes. */
  MAX_OUTPUT_BYTES: 64 * 1024,
  /** Wall-clock limit for one run, including compilation. */
  RUN_TIMEOUT_MS: 5_000,
  SANDBOX_MEMORY_BYTES: 128 * 1024 * 1024,
  SANDBOX_NANO_CPUS: 500_000_000,
  SANDBOX_PIDS_LIMIT: 64,
  SANDBOX_TMPFS_SIZE: '16m',
  RUN_HISTORY_DEFAULT: 20,
  RUN_HISTORY_MAX: 100,
} as const;

/** Redis pub/sub channel the worker publishes run updates to. */
export const RUN_RESULTS_CHANNEL = 'run:results';
/** BullMQ queue name. */
export const RUN_QUEUE_NAME = 'runs';
/** Name of the Y.Text inside each room's Y.Doc that holds the source code. */
export const YDOC_TEXT_KEY = 'monaco';
