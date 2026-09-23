import type { FastifyError, FastifyInstance } from 'fastify';
import { ERROR_CODES, type ErrorResponse } from '@codesync/shared';
import { AppError } from '../lib/errors';

function body(code: string, message: string): ErrorResponse {
  return { error: { code, message } };
}

/** Every error leaves the API as `{ error: { code, message } }`. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | AppError, request, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).headers(err.headers).send(body(err.code, err.message));
    }
    if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.status(413).send(body(ERROR_CODES.PAYLOAD_TOO_LARGE, 'Request body is too large'));
    }
    if (err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || err.code === 'FST_ERR_CTP_EMPTY_JSON_BODY') {
      return reply.status(400).send(body(ERROR_CODES.VALIDATION_ERROR, err.message));
    }
    if (err.statusCode === 400) {
      return reply.status(400).send(body(ERROR_CODES.VALIDATION_ERROR, err.message));
    }
    request.log.error({ err }, 'unhandled error');
    return reply.status(500).send(body(ERROR_CODES.INTERNAL, 'Internal server error'));
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send(body(ERROR_CODES.NOT_FOUND, `Route ${request.method} ${request.url} not found`));
  });
}
