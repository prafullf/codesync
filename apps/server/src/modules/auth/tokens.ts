import jwt from 'jsonwebtoken';
import { z } from 'zod';

export const AUTH_COOKIE = 'codesync_token';
export const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/** What we know about the caller after verifying their cookie. */
export interface AuthUser {
  id: string;
  name: string;
}

const claimsSchema = z.object({ sub: z.string(), name: z.string() });

export function signToken(user: AuthUser, secret: string): string {
  return jwt.sign({ name: user.name }, secret, {
    subject: user.id,
    expiresIn: TOKEN_TTL_SECONDS,
    algorithm: 'HS256',
  });
}

export function verifyToken(token: string, secret: string): AuthUser | null {
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    const claims = claimsSchema.parse(decoded);
    return { id: claims.sub, name: claims.name };
  } catch {
    return null;
  }
}

/** Read the auth cookie out of a raw `Cookie:` header (used by WebSocket upgrades). */
export function tokenFromCookieHeader(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === AUTH_COOKIE) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function authenticateCookieHeader(header: string | undefined, secret: string): AuthUser | null {
  const token = tokenFromCookieHeader(header);
  return token ? verifyToken(token, secret) : null;
}
