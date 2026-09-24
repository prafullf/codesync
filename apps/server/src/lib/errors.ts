import type { ErrorCode } from '@codesync/shared';
import { ERROR_CODES } from '@codesync/shared';

/** An expected, user-facing error. Anything else is treated as a 500. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errors = {
  validation: (message: string) => new AppError(400, ERROR_CODES.VALIDATION_ERROR, message),
  unauthorized: (message = 'Authentication required') => new AppError(401, ERROR_CODES.UNAUTHORIZED, message),
  forbidden: (message = 'You do not have access to this resource') =>
    new AppError(403, ERROR_CODES.FORBIDDEN, message),
  notFound: (message = 'Not found') => new AppError(404, ERROR_CODES.NOT_FOUND, message),
  conflict: (message: string) => new AppError(409, ERROR_CODES.CONFLICT, message),
  payloadTooLarge: (message: string) => new AppError(413, ERROR_CODES.PAYLOAD_TOO_LARGE, message),
  rateLimited: (retryAfterSeconds: number) =>
    new AppError(429, ERROR_CODES.RATE_LIMITED, `Too many requests. Retry in ${retryAfterSeconds}s.`, {
      'retry-after': String(retryAfterSeconds),
    }),
  queueFull: () =>
    new AppError(503, ERROR_CODES.QUEUE_FULL, 'Execution queue is full. Please try again shortly.', {
      'retry-after': '10',
    }),
};
