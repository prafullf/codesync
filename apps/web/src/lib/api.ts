import type { z } from 'zod';
import {
  authResponseSchema,
  createRunResponseSchema,
  errorResponseSchema,
  roomListResponseSchema,
  roomResponseSchema,
  roomSummarySchema,
  runListResponseSchema,
  runResponseSchema,
  type CreateRoomBody,
  type CreateRunBody,
  type LoginBody,
  type SignupBody,
  type UpdateRoomBody,
} from '@codesync/shared';
import { z as zod } from 'zod';
import { API_URL } from './config';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

async function request<S extends z.ZodTypeAny>(
  method: string,
  path: string,
  schema: S | null,
  body?: unknown,
): Promise<z.output<S>> {
  const res = await fetch(API_URL + path, {
    method,
    credentials: 'include',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = errorResponseSchema.safeParse(data);
    const retryAfter = Number(res.headers.get('retry-after')) || undefined;
    throw parsed.success
      ? new ApiError(res.status, parsed.data.error.code, parsed.data.error.message, retryAfter)
      : new ApiError(res.status, 'INTERNAL', res.statusText || 'Request failed', retryAfter);
  }
  // Responses are validated with the same shared schemas the server uses.
  return schema ? schema.parse(data) : (undefined as z.output<S>);
}

const roomSummaryResponse = zod.object({ room: roomSummarySchema });

export const api = {
  signup: (body: SignupBody) => request('POST', '/api/auth/signup', authResponseSchema, body),
  login: (body: LoginBody) => request('POST', '/api/auth/login', authResponseSchema, body),
  logout: () => request('POST', '/api/auth/logout', null),
  me: () => request('GET', '/api/auth/me', authResponseSchema),

  listRooms: () => request('GET', '/api/rooms', roomListResponseSchema),
  createRoom: (body: CreateRoomBody) => request('POST', '/api/rooms', roomSummaryResponse, body),
  getRoom: (roomId: string) => request('GET', `/api/rooms/${roomId}`, roomResponseSchema),
  joinRoom: (roomId: string) => request('POST', `/api/rooms/${roomId}/join`, roomResponseSchema),
  updateRoom: (roomId: string, body: UpdateRoomBody) =>
    request('PATCH', `/api/rooms/${roomId}`, roomSummaryResponse, body),

  createRun: (roomId: string, body: CreateRunBody) =>
    request('POST', `/api/rooms/${roomId}/runs`, createRunResponseSchema, body),
  listRuns: (roomId: string, limit = 20) =>
    request('GET', `/api/rooms/${roomId}/runs?limit=${limit}`, runListResponseSchema),
  getRun: (runId: string) => request('GET', `/api/runs/${runId}`, runResponseSchema),
};
