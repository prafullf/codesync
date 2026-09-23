import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { errors } from '../lib/errors';
import { AUTH_COOKIE, type AuthUser, verifyToken } from '../modules/auth/tokens';

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthUser | null;
  }
}

/** preHandler that rejects requests without a valid auth cookie. */
export function requireAuth(jwtSecret: string): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const token = request.cookies[AUTH_COOKIE];
    const user = token ? verifyToken(token, jwtSecret) : null;
    if (!user) throw errors.unauthorized();
    request.authUser = user;
  };
}

/** Use inside handlers that ran behind requireAuth. */
export function currentUser(request: FastifyRequest): AuthUser {
  if (!request.authUser) throw errors.unauthorized();
  return request.authUser;
}
