export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      aria-hidden
    />
  );
}

export function FullPageSpinner() {
  return (
    <div className="flex h-full items-center justify-center text-zinc-400">
      <Spinner className="h-6 w-6" />
    </div>
  );
}
