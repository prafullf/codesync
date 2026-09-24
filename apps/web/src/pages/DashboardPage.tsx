import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { LANGUAGES, LANGUAGE_LABELS, type Language, type RoomSummary } from '@codesync/shared';
import { useAuth } from '../auth/AuthContext';
import { Logo } from '../components/Logo';
import { Spinner } from '../components/Spinner';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { roomIdFromInput } from '../lib/links';

export function DashboardPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<Language>('PYTHON');
  const [creating, setCreating] = useState(false);
  const [invite, setInvite] = useState('');

  useEffect(() => {
    api
      .listRooms()
      .then((res) => setRooms(res.rooms))
      .catch((err: unknown) => {
        toast.error(errorMessage(err));
        setRooms([]);
      });
  }, []);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const { room } = await api.createRoom({ name, language });
      navigate(`/room/${room.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
      setCreating(false);
    }
  };

  const onJoin = (e: FormEvent) => {
    e.preventDefault();
    const id = roomIdFromInput(invite);
    if (!id) return toast.error('That does not look like an invite link');
    navigate(`/room/${id}`);
  };

  return (
    <div className="min-h-full">
      <header className="border-b border-zinc-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Logo />
          <div className="flex items-center gap-3 text-sm text-zinc-400">
            <span>{user?.name}</span>
            <button className="btn-ghost" onClick={() => void logout()}>
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-4 py-8">
        <section className="grid gap-4 md:grid-cols-2">
          <form onSubmit={onCreate} className="card space-y-3 p-5">
            <h2 className="font-medium">New room</h2>
            <input
              className="input"
              placeholder="Room name, e.g. Two Sum practice"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={80}
              aria-label="Room name"
            />
            <div className="flex gap-2">
              <select
                className="input"
                value={language}
                onChange={(e) => setLanguage(e.target.value as Language)}
                aria-label="Language"
              >
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {LANGUAGE_LABELS[l]}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn-primary shrink-0" disabled={creating}>
                {creating && <Spinner />}
                Create room
              </button>
            </div>
          </form>

          <form onSubmit={onJoin} className="card space-y-3 p-5">
            <h2 className="font-medium">Join with an invite link</h2>
            <input
              className="input"
              placeholder="https://…/room/…"
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              required
              aria-label="Invite link"
            />
            <button type="submit" className="btn-ghost">
              Join room
            </button>
          </form>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-400">My rooms</h2>
          {rooms === null ? (
            <Spinner />
          ) : rooms.length === 0 ? (
            <p className="text-sm text-zinc-500">No rooms yet. Create one above and share the link.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {rooms.map((room) => (
                <li key={room.id}>
                  <Link
                    to={`/room/${room.id}`}
                    className="card block p-4 transition-colors hover:border-zinc-600"
                  >
                    <div className="truncate font-medium">{room.name}</div>
                    <div className="mt-2 flex items-center justify-between text-xs text-zinc-400">
                      <span>{LANGUAGE_LABELS[room.language]}</span>
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5">{room.role.toLowerCase()}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
