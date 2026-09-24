# Benchmarks

All numbers below come from real runs of the k6 scripts in [`load-tests/`](../load-tests). The raw k6 output is in [`load-tests/results/`](../load-tests/results).

## Setup

|                |                                                                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Machine        | Apple M2, 8 cores, 8 GB RAM (MacBook)                                                                                                                                        |
| Docker         | Docker Desktop, VM limited to 8 CPUs / 4 GB                                                                                                                                  |
| Stack          | `docker compose --profile app up`: 1 API container, **3 worker replicas** (`WORKER_CONCURRENCY=2` each, so 6 execution slots), Postgres 16, Redis 7, all on the same machine |
| Load generator | `grafana/k6` in a container on the same machine, hitting `host.docker.internal:4000`                                                                                         |
| Date           | 2026-09-24                                                                                                                                                                   |

Everything shares one laptop, so treat these numbers as relative, not absolute. The load generator, the API and every sandbox container compete for the same CPUs.

## (a) Execution pipeline: 200 run requests/min

`load-tests/runs.js`. 30 users, constant arrival rate of **200 runs/min for 3 minutes**, alternating Python and JavaScript programs. For each run, k6 calls `POST /api/rooms/:id/runs` and then polls `GET /api/runs/:id` every 100 ms until the run finishes. That gives the **turnaround**: enqueue → BullMQ → worker → fresh Docker container → result in Postgres.

| Metric                         | Result                                                           |
| ------------------------------ | ---------------------------------------------------------------- |
| Runs completed                 | **600 / 600** (100 % success)                                    |
| HTTP error rate                | **0.00 %** (0 of 1,905 requests)                                 |
| `POST /runs` latency (enqueue) | p50 **5.2 ms**, p95 **16 ms**, max 112 ms                        |
| Turnaround (submit → result)   | avg **231 ms**, p50 **217 ms**, p95 **240 ms**, max 1.1 s        |
| Work distribution              | Runs were spread across all 3 worker replicas (from worker logs) |

The turnaround is dominated by creating and starting a fresh container (~100–200 ms on this machine). The user program itself runs in ~40 ms.

### Stress: 1,200 run requests/min (finding the limit)

Same script with `RATE_PER_MIN=1200` for 1 minute. The per-user run limit was raised for this test only, to measure raw capacity.

| Metric                | Result                                                                          |
| --------------------- | ------------------------------------------------------------------------------- |
| Runs completed        | 736 (100 % success, 0 HTTP errors)                                              |
| Throughput            | **~10.4 runs/s (~620 runs/min)**                                                |
| Turnaround            | p50 **7.7 s**, p95 **14.9 s**: the queue grew because demand was above capacity |
| `POST /runs` p95      | 750 ms (API shares the CPUs with the sandboxes)                                 |
| k6 dropped iterations | 465 (the load generator ran out of VUs while polling)                           |

**What this shows:** with 6 execution slots, the system saturates at ~600 runs/min on one laptop. Past that point, jobs wait in the queue instead of failing. Nothing crashed and every run eventually completed. That is the point of having a queue. To go further you add worker replicas or hosts (workers are stateless), or reduce per-run overhead with a warm container pool (see README → Future improvements). The `MAX_QUEUE_LENGTH` guard (503 above 500 waiting jobs) caps how long the queue can get.

## (b) Real-time: 50 concurrent WebSocket clients in one room

`load-tests/websocket.js`. 50 users join one room and each opens a y-websocket connection with the real binary protocol: sync handshake, then an awareness (cursor) update every second for 60 s. Each update carries a timestamp. The server fans every update out to the other 49 clients, and each receiver records the delay.

| Metric                                          | Result                                                  |
| ----------------------------------------------- | ------------------------------------------------------- |
| Connections                                     | **50 / 50** upgraded (101), all held for the full 60 s  |
| WebSocket connect time                          | avg **41 ms**, p95 **57 ms**                            |
| Initial document sync                           | avg **42 ms**, p95 **58 ms**                            |
| Broadcast latency (sender → every other client) | avg **33 ms**, p50 **29 ms**, p95 **68 ms**, max 179 ms |
| Messages delivered                              | **~2,270 / s** (144,591 awareness messages in ~64 s)    |

The spec's target for local edits is < 200 ms, and p95 here is 68 ms under 50× fan-out. The integration test `apps/server/test/yjs.test.ts` also asserts that a document edit reaches a second client in < 200 ms.

## Resilience check: killing a worker mid-job

This was a manual test, recorded here:

1. Submitted `time.sleep(3); print("survived")`, so the run was `RUNNING` on a worker.
2. Sent `SIGKILL` to that worker process (no graceful shutdown).
3. Started a fresh worker.

**Result:** after BullMQ's stalled-job check (lock expiry, ~30–60 s), the new worker picked the job up again. The run moved `RUNNING → RUNNING → SUCCESS` with stdout `survived`. No job was lost. The `RUNNING → RUNNING` transition is explicitly allowed by the run state machine for exactly this case.

## Reproduce

```bash
pnpm build:sandbox
AUTH_RATE_LIMIT_PER_MIN=100000 docker compose --profile app up -d --build
docker run --rm -v "$PWD/load-tests:/scripts" -e BASE_URL=http://host.docker.internal:4000 grafana/k6 run /scripts/runs.js
docker run --rm -v "$PWD/load-tests:/scripts" -e BASE_URL=http://host.docker.internal:4000 grafana/k6 run /scripts/websocket.js
```

The load tests sign up many users from one IP, so the auth limiter (5/min/IP) is raised for the benchmark via `AUTH_RATE_LIMIT_PER_MIN`. The run limiter (10/min/user) stays on for test (a).
