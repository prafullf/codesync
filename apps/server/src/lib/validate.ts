import type { z } from 'zod';
import { errors } from './errors';

/** Validate untrusted input against a shared Zod schema, or throw a 400. */
export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.issues
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ');
    throw errors.validation(message);
  }
  return result.data;
}
