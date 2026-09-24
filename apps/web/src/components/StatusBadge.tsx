import type { RunStatus } from '@codesync/shared';
import { Spinner } from './Spinner';

const STYLES: Record<RunStatus, string> = {
  QUEUED: 'bg-zinc-700/60 text-zinc-200',
  RUNNING: 'bg-sky-500/15 text-sky-300',
  SUCCESS: 'bg-emerald-500/15 text-emerald-300',
  ERROR: 'bg-rose-500/15 text-rose-300',
  TIMEOUT: 'bg-amber-500/15 text-amber-300',
};

const LABELS: Record<RunStatus, string> = {
  QUEUED: 'Queued',
  RUNNING: 'Running',
  SUCCESS: 'Success',
  ERROR: 'Error',
  TIMEOUT: 'Timeout',
};

export function StatusBadge({ status }: { status: RunStatus }) {
  return (
    <span
      data-testid="run-status"
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {(status === 'QUEUED' || status === 'RUNNING') && <Spinner className="h-3 w-3" />}
      {LABELS[status]}
    </span>
  );
}
