/** Accepts a full invite link or a bare room id. */
export function roomIdFromInput(input: string): string | null {
  const trimmed = input.trim();
  const match = /\/room\/([A-Za-z0-9_-]+)/.exec(trimmed);
  if (match?.[1]) return match[1];
  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null;
}

/** Only allow in-app redirects after login (prevents open redirects via ?next=). */
export function safeNext(raw: string | null): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\') ? raw : '/dashboard';
}
