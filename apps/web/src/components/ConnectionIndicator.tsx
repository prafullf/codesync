export function ConnectionIndicator({ online }: { online: boolean }) {
  return (
    <span
      className="flex items-center gap-1.5 text-xs text-zinc-400"
      title={online ? 'Connected' : 'Offline: your edits are kept locally and sync on reconnect'}
      data-testid="connection"
    >
      <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-400' : 'animate-pulse bg-amber-400'}`} />
      {online ? 'Connected' : 'Reconnecting…'}
    </span>
  );
}
