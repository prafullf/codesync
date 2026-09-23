import type { FastifyInstance, FastifyReply } from 'fastify';
import { loginBodySchema, signupBodySchema, type AuthResponse } from '@codesync/shared';
import { parse } from '../../lib/validate';
import { currentUser } from '../../plugins/authenticate';
import type { RouteDeps } from '../../app';
import { AUTH_COOKIE, TOKEN_TTL_SECONDS } from './tokens';

export async function authRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { authService, env, requireAuth, rateLimit } = deps;

  const authLimiter = rateLimit({
    name: 'auth',
    limit: env.AUTH_RATE_LIMIT_PER_MIN,
    windowMs: 60_000,
    key: (request) => request.ip,
  });

  const setCookie = (reply: FastifyReply, token: string) =>
    reply.setCookie(AUTH_COOKIE, token, {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      maxAge: TOKEN_TTL_SECONDS,
    });

  app.post('/api/auth/signup', { preHandler: authLimiter }, async (request, reply) => {
    const body = parse(signupBodySchema, request.body);
    const { user, token } = await authService.signup(body);
    setCookie(reply, token);
    return reply.status(201).send({ user } satisfies AuthResponse);
  });

  app.post('/api/auth/login', { preHandler: authLimiter }, async (request, reply) => {
    const body = parse(loginBodySchema, request.body);
    const { user, token } = await authService.login(body);
    setCookie(reply, token);
    return { user } satisfies AuthResponse;
  });

  app.post('/api/auth/logout', { preHandler: requireAuth }, async (_request, reply) => {
    reply.clearCookie(AUTH_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (request) => {
    const user = await authService.me(currentUser(request).id);
    return { user } satisfies AuthResponse;
  });
}
