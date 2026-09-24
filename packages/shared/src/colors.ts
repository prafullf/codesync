const PALETTE = [
  '#f87171',
  '#fb923c',
  '#fbbf24',
  '#a3e635',
  '#34d399',
  '#22d3ee',
  '#60a5fa',
  '#a78bfa',
  '#f472b6',
  '#e879f9',
] as const;

/** Stable colour per user so cursors and avatars match across sessions. */
export function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length] ?? PALETTE[0];
}
