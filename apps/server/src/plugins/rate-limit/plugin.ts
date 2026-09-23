import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { errors } from '../../lib/errors';
import type { RateLimitStore } from './store';

export interface RateLimitRule {
  /** Namespaces the key so different rules never share counters. */
  name: string;
  limit: number;
  windowMs: number;
  /** Who is being limited: user id, IP, ... */
  key: (request: FastifyRequest) => string;
}

export type RateLimitFactory = (rule: RateLimitRule) => preHandlerAsyncHookHandler;

declare module 'fastify' {
  interface FastifyInstance {
    rateLimit: RateLimitFactory;
  }
}

export interface RateLimitPluginOptions {
  store: RateLimitStore;
  /**
   * If the store (Redis) is down: true = let requests through (availability),
   * false = reject them (safety). We fail open and log loudly.
   */
  failOpen?: boolean;
}

async function rateLimitPlugin(app: FastifyInstance, opts: RateLimitPluginOptions): Promise<void> {
  const failOpen = opts.failOpen ?? true;

  const factory: RateLimitFactory = (rule) => async (request, reply) => {
    const key = `${rule.name}:${rule.key(request)}`;
    let result;
    try {
      result = await opts.store.hit(key, rule.limit, rule.windowMs);
    } catch (err) {
      request.log.error({ err, rule: rule.name }, 'rate limit store unavailable');
      if (failOpen) return;
      throw err;
    }

    reply.header('x-ratelimit-limit', rule.limit);
    reply.header('x-ratelimit-remaining', result.remaining);
    if (!result.allowed) {
      throw errors.rateLimited(Math.ceil(result.retryAfterMs / 1000));
    }
  };

  app.decorate('rateLimit', factory);
}

export default fp(rateLimitPlugin, { name: 'codesync-rate-limit' });
