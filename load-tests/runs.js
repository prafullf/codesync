/**
 * (a) 200 run requests per minute against the execution pipeline.
 *
 * Measures API latency for POST /runs (enqueue) and end-to-end turnaround
 * (enqueue -> worker -> sandbox container -> result in Postgres), by polling.
 *
 *   k6 run -e BASE_URL=http://localhost:4000 load-tests/runs.js
 *
 * The API must allow many signups from one IP: start it with AUTH_RATE_LIMIT_PER_MIN=100000.
 * Runs are spread over 30 users so the real 10 runs/min/user limit still applies.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Rate, Trend } from 'k6/metrics';
import { BASE_URL, createRoom, signup } from './lib.js';

const USERS = 30;
const RATE_PER_MIN = Number(__ENV.RATE_PER_MIN || 200);
const DURATION = __ENV.DURATION || '3m';

const turnaround = new Trend('run_turnaround_ms', true);
const runsCompleted = new Counter('runs_completed');
const runSucceeded = new Rate('run_success');
const rateLimited = new Counter('runs_rate_limited');

export const options = {
  setupTimeout: '120s',
  scenarios: {
    runs: {
      executor: 'constant-arrival-rate',
      rate: RATE_PER_MIN,
      timeUnit: '1m',
      duration: DURATION,
      preAllocatedVUs: 40,
      maxVUs: 100,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:create_run}': ['p(95)<500'],
    run_success: ['rate>0.99'],
  },
};

const PROGRAMS = [
  { language: 'PYTHON', code: 'print(sum(i * i for i in range(10000)))' },
  { language: 'JAVASCRIPT', code: 'let s = 0; for (let i = 0; i < 1e5; i++) s += i; console.log(s);' },
];

export function setup() {
  const users = [];
  for (let i = 0; i < USERS; i++) {
    const cookie = signup(`load${i}`);
    users.push({ cookie, roomId: createRoom(cookie, 'PYTHON') });
  }
  return { users };
}

export default function (data) {
  const i = exec.scenario.iterationInTest;
  const user = data.users[i % data.users.length];
  const program = PROGRAMS[i % PROGRAMS.length];

  const started = Date.now();
  const res = http.post(`${BASE_URL}/api/rooms/${user.roomId}/runs`, JSON.stringify(program), {
    headers: { 'content-type': 'application/json', cookie: user.cookie },
    tags: { name: 'create_run' },
    responseCallback: http.expectedStatuses(202, 429),
  });
  if (res.status === 429) {
    rateLimited.add(1);
    return;
  }
  check(res, { 'run accepted (202)': (r) => r.status === 202 });
  const runId = res.json('runId');

  // Poll until the worker reports a terminal status (the UI gets this over Socket.IO).
  for (let attempt = 0; attempt < 300; attempt++) {
    sleep(0.1);
    const poll = http.get(`${BASE_URL}/api/runs/${runId}`, {
      headers: { cookie: user.cookie },
      tags: { name: 'poll_run' },
    });
    const status = poll.json('run.status');
    if (status === 'SUCCESS' || status === 'ERROR' || status === 'TIMEOUT') {
      turnaround.add(Date.now() - started);
      runsCompleted.add(1);
      runSucceeded.add(status === 'SUCCESS');
      return;
    }
  }
  runSucceeded.add(false);
}
