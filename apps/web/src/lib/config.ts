/** Empty = same origin (dev proxy or a reverse proxy in production). */
export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

/** ws(s):// base for the Yjs WebSocket. */
export function wsBaseUrl(): string {
  const base = API_URL || window.location.origin;
  return base.replace(/^http/, 'ws');
}
