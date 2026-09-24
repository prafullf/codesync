import http from 'k6/http';
import { check } from 'k6';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';

/** Sign up a fresh user; returns the Cookie header value for later requests. */
export function signup(name) {
  const email = `${name}-${Date.now()}-${Math.floor(Math.random() * 1e9)}@k6.dev`;
  const res = http.post(
    `${BASE_URL}/api/auth/signup`,
    JSON.stringify({ email, name, password: 'password123' }),
    { headers: { 'content-type': 'application/json' } },
  );
  check(res, { 'signup 201': (r) => r.status === 201 });
  const token = res.cookies.codesync_token && res.cookies.codesync_token[0].value;
  if (!token) throw new Error(`signup failed: ${res.status} ${res.body}`);
  return `codesync_token=${token}`;
}

export function createRoom(cookie, language) {
  const res = http.post(`${BASE_URL}/api/rooms`, JSON.stringify({ name: 'k6 room', language }), {
    headers: { 'content-type': 'application/json', cookie },
  });
  check(res, { 'room 201': (r) => r.status === 201 });
  return res.json('room.id');
}

export function joinRoom(cookie, roomId) {
  const res = http.post(`${BASE_URL}/api/rooms/${roomId}/join`, null, { headers: { cookie } });
  check(res, { 'join 200': (r) => r.status === 200 });
}
