import type { Run, RunStatus } from '@codesync/shared';
import { StatusBadge } from './StatusBadge';

/** What we know about a run: may be partial while it's still streaming in over Socket.IO. */
export interface RunView {
  runId: string;
  userId: string;
  userName: string;
  status: RunStatus;
  stdout?: string | null;
  stderr?: string | null;
  exitCode?: number | null;
  durationMs?: number | null;
  createdAt?: string;
}

export function runToView(run: Run): RunView {
  return { ...run, runId: run.id };
}

type Tab = 'output' | 'history';

interface Props {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  active: RunView | null;
  history: Run[];
  onSelect: (run: Run) => void;
}

function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return new Date(iso).toLocaleString();
}

export function OutputPanel({ tab, onTabChange, active, history, onSelect }: Props) {
  return (
    <section className="flex h-full min-h-0 flex-col bg-zinc-950">
      <div className="flex items-center gap-1 border-b border-zinc-800 px-2" role="tablist">
        {(['output', 'history'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => onTabChange(t)}
            className={`border-b-2 px-3 py-2 text-sm capitalize ${
              tab === t
                ? 'border-indigo-500 text-zinc-100'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'output' ? (
        <div className="min-h-0 flex-1 overflow-auto p-3" data-testid="output-panel">
          {!active ? (
            <p className="text-sm text-zinc-500">
              Press <kbd className="rounded bg-zinc-800 px-1">Ctrl/⌘ + Enter</kbd> or click Run. Output is
              shared with everyone in the room.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                <StatusBadge status={active.status} />
                <span>
                  by <span className="text-zinc-200">{active.userName}</span>
                </span>
                {active.durationMs != null && <span>· {active.durationMs} ms</span>}
                {active.exitCode != null && <span>· exit {active.exitCode}</span>}
              </div>
              {active.stdout ? (
                <pre
                  className="whitespace-pre-wrap break-words font-mono text-sm text-zinc-100"
                  data-testid="stdout"
                >
                  {active.stdout}
                </pre>
              ) : null}
              {active.stderr ? (
                <pre
                  className="whitespace-pre-wrap break-words font-mono text-sm text-rose-300"
                  data-testid="stderr"
                >
                  {active.stderr}
                </pre>
              ) : null}
              {(active.status === 'SUCCESS' || active.status === 'ERROR') &&
                !active.stdout &&
                !active.stderr && <p className="text-sm italic text-zinc-500">(no output)</p>}
            </div>
          )}
        </div>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-zinc-800/70 overflow-auto" data-testid="history-panel">
          {history.length === 0 && <li className="p-3 text-sm text-zinc-500">No runs yet.</li>}
          {history.map((run) => (
            <li key={run.id}>
              <button
                onClick={() => onSelect(run)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-900"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <StatusBadge status={run.status} />
                  <span className="truncate text-zinc-300">{run.userName}</span>
                </span>
                <span className="shrink-0 text-xs text-zinc-500">
                  {run.durationMs != null ? `${run.durationMs} ms · ` : ''}
                  {timeAgo(run.createdAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
