import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { toast } from 'sonner';
import {
  isTerminal,
  LANGUAGES,
  LANGUAGE_LABELS,
  MONACO_LANGUAGE,
  type Language,
  type RoomDetails,
  type RoomUpdatedPayload,
  type Run,
  type RunUpdateEvent,
} from '@codesync/shared';
import { useAuth } from '../auth/AuthContext';
import { Avatars } from '../components/Avatars';
import { ConnectionIndicator } from '../components/ConnectionIndicator';
import { OutputPanel, runToView, type RunView } from '../components/OutputPanel';
import { FullPageSpinner, Spinner } from '../components/Spinner';
import { useCollab } from '../hooks/useCollab';
import { useRoomSocket } from '../hooks/useRoomSocket';
import { api, ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { monaco } from '../lib/monaco';

const POLL_INTERVAL_MS = 2_000;

export function RoomPage() {
  const { roomId = '' } = useParams();
  const { user } = useAuth();
  const [room, setRoom] = useState<RoomDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editor, setEditor] = useState<monaco.editor.IStandaloneCodeEditor | null>(null);

  const [runs, setRuns] = useState<Record<string, RunView>>({});
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [myPendingRunId, setMyPendingRunId] = useState<string | null>(null);
  const [history, setHistory] = useState<Run[]>([]);
  const [tab, setTab] = useState<'output' | 'history'>('output');
  const [submitting, setSubmitting] = useState(false);

  // Load the room; if we're not a member yet, the link is an invite: join it.
  useEffect(() => {
    let cancelled = false;
    setRoom(null);
    setLoadError(null);
    (async () => {
      try {
        const { room: r } = await api.getRoom(roomId);
        if (!cancelled) setRoom(r);
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          try {
            const { room: r } = await api.joinRoom(roomId);
            if (!cancelled) {
              setRoom(r);
              toast.success(`Joined “${r.name}”`);
            }
          } catch (joinErr) {
            if (!cancelled) setLoadError(errorMessage(joinErr));
          }
        } else if (!cancelled) {
          setLoadError(
            err instanceof ApiError && err.status === 404 ? 'This room does not exist.' : errorMessage(err),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  const refreshHistory = useCallback(() => {
    api
      .listRuns(roomId)
      .then((res) => setHistory(res.runs))
      .catch(() => undefined);
  }, [roomId]);

  const roomLoaded = room !== null;
  useEffect(() => {
    if (roomLoaded) refreshHistory();
  }, [roomLoaded, refreshHistory]);

  const applyRunUpdate = useCallback(
    (update: RunView) => {
      setRuns((prev) => ({ ...prev, [update.runId]: { ...prev[update.runId], ...update } }));
      if (update.status === 'QUEUED') {
        setActiveRunId(update.runId);
        setTab('output');
      } else {
        setActiveRunId((current) => current ?? update.runId);
      }
      if (isTerminal(update.status)) {
        setMyPendingRunId((pending) => (pending === update.runId ? null : pending));
        refreshHistory();
      }
    },
    [refreshHistory],
  );

  const onRunUpdate = useCallback((e: RunUpdateEvent) => applyRunUpdate(e), [applyRunUpdate]);
  const onRoomUpdated = useCallback((e: RoomUpdatedPayload) => {
    setRoom((prev) => (prev ? { ...prev, name: e.name, language: e.language } : prev));
  }, []);

  const socket = useRoomSocket(room ? roomId : null, { onRunUpdate, onRoomUpdated });
  const collab = useCollab(roomId, room ? editor : null, user);

  // Polling fallback: if the realtime socket is down while our run is in flight.
  useEffect(() => {
    if (!myPendingRunId || socket.connected) return;
    const timer = setInterval(() => {
      api
        .getRun(myPendingRunId)
        .then(({ run }) => applyRunUpdate(runToView(run)))
        .catch(() => undefined);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [myPendingRunId, socket.connected, applyRunUpdate]);

  const isViewer = room?.role === 'VIEWER';
  const isOwner = room?.role === 'OWNER';
  const runDisabled = !room || isViewer || submitting || myPendingRunId !== null;

  const run = useCallback(async () => {
    if (!room || runDisabled || !user) return;
    const code = collab.getCode();
    if (!code.trim()) return void toast.error('Nothing to run yet');
    setSubmitting(true);
    try {
      const { runId } = await api.createRun(roomId, { language: room.language, code });
      setMyPendingRunId(runId);
      applyRunUpdate({ runId, status: 'QUEUED', userId: user.id, userName: user.name });
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        toast.error(`Rate limit reached (10 runs/min). Try again in ${err.retryAfterSeconds ?? 60}s.`);
      } else {
        toast.error(errorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  }, [room, runDisabled, user, collab, roomId, applyRunUpdate]);

  // Ctrl/Cmd + Enter inside the editor. A ref keeps the command pointing at the latest `run`.
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  }, [run]);
  useEffect(() => {
    editor?.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => void runRef.current());
  }, [editor]);

  const changeLanguage = async (language: Language) => {
    try {
      const { room: updated } = await api.updateRoom(roomId, { language });
      setRoom((prev) => (prev ? { ...prev, language: updated.language } : prev));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const copyInvite = async () => {
    const link = `${window.location.origin}/room/${roomId}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Invite link copied');
    } catch {
      toast.message(link);
    }
  };

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-zinc-300">{loadError}</p>
        <Link to="/dashboard" className="btn-ghost">
          Back to dashboard
        </Link>
      </div>
    );
  }
  if (!room) return <FullPageSpinner />;

  const active = activeRunId ? (runs[activeRunId] ?? null) : null;
  const online = collab.status === 'connected' && socket.connected;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-3 py-2">
        <Link to="/dashboard" className="text-zinc-400 hover:text-zinc-100" aria-label="Back to dashboard">
          ←
        </Link>
        <h1 className="max-w-[16rem] truncate font-medium" data-testid="room-name">
          {room.name}
        </h1>
        {isOwner ? (
          <select
            className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
            value={room.language}
            onChange={(e) => void changeLanguage(e.target.value as Language)}
            aria-label="Language"
          >
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_LABELS[l]}
              </option>
            ))}
          </select>
        ) : (
          <span className="rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-300">
            {LANGUAGE_LABELS[room.language]}
          </span>
        )}
        {isViewer && (
          <span className="rounded-md bg-amber-500/15 px-2 py-1 text-xs text-amber-300">View only</span>
        )}

        <div className="ml-auto flex items-center gap-3">
          <ConnectionIndicator online={online} />
          <Avatars users={socket.presence} />
          <button className="btn-ghost" onClick={() => void copyInvite()}>
            Copy invite link
          </button>
          <button
            className="btn-primary"
            onClick={() => void run()}
            disabled={runDisabled}
            title="Run (Ctrl/⌘ + Enter)"
            data-testid="run-button"
          >
            {myPendingRunId || submitting ? <Spinner /> : '▶'}
            Run
          </button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-rows-[1fr_40%] lg:grid-cols-[1fr_420px] lg:grid-rows-1">
        <div className="min-h-0 border-zinc-800 lg:border-r" data-testid="editor">
          <Editor
            theme="vs-dark"
            language={MONACO_LANGUAGE[room.language]}
            onMount={(ed) => setEditor(ed)}
            loading={<Spinner />}
            options={{
              readOnly: isViewer,
              fontSize: 14,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: room.language === 'PYTHON' ? 4 : 2,
              padding: { top: 12 },
            }}
          />
        </div>
        <div className="min-h-0 border-t border-zinc-800 lg:border-t-0">
          <OutputPanel
            tab={tab}
            onTabChange={setTab}
            active={active}
            history={history}
            onSelect={(r) => {
              applyRunUpdate(runToView(r));
              setActiveRunId(r.id);
              setTab('output');
            }}
          />
        </div>
      </main>
    </div>
  );
}
