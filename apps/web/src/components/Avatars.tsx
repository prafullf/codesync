import type { PresenceUser } from '@codesync/shared';

export function Avatars({ users }: { users: PresenceUser[] }) {
  const shown = users.slice(0, 5);
  return (
    <div className="flex -space-x-2" aria-label={`${users.length} online`}>
      {shown.map((u) => (
        <span
          key={u.id}
          title={u.name}
          className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-zinc-950 text-xs font-semibold text-zinc-950"
          style={{ backgroundColor: u.color }}
        >
          {u.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
      {users.length > shown.length && (
        <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-zinc-950 bg-zinc-700 text-xs">
          +{users.length - shown.length}
        </span>
      )}
    </div>
  );
}
