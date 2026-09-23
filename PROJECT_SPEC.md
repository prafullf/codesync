# CodeSync — Real-time Collaborative Code Editor with Sandboxed Execution

> Instructions for an AI coding agent (or developer) to build this project **phase by phase**.
> Read this whole file before writing any code. Finish one phase, verify its acceptance criteria, then move to the next.

---

## 1. Goal

Build a production-quality web app where multiple users can:

1. Create or join a **room** using a shareable link.
2. Edit the same code file **in real time** (live cursors, no conflicts).
3. Click **Run** to execute the code in an **isolated Docker sandbox** and see stdout/stderr, shown to everyone in the room.

This is a portfolio project for SDE job applications. Code quality, architecture clarity, and a strong README matter as much as the features.

---

## 2. Tech Stack (use exactly this unless told otherwise)

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere (`strict: true`) |
| Monorepo | pnpm workspaces |
| Frontend | React + Vite, Monaco Editor, TailwindCSS |
| Real-time doc sync | Yjs + `y-monaco` + `y-websocket` (CRDT) |
| App events | Socket.IO (run status, room events) |
| Backend API | Node.js + Fastify |
| Validation | Zod (shared schemas) |
| Database | PostgreSQL + Prisma ORM |
| Cache / Queue / PubSub | Redis + BullMQ |
| Code execution | Separate worker service using `dockerode` |
| Auth | Email + password, bcrypt, JWT in httpOnly cookie |
| Testing | Vitest (unit/integration), Playwright (1–2 E2E), k6 (load) |
| Local infra | docker-compose |
| CI | GitHub Actions (lint, typecheck, test) |

---

## 3. Architecture

```
 Browser (React + Monaco + Yjs)
    │  HTTP (REST)      │ WS: /yjs (doc sync)     │ WS: Socket.IO (events)
    ▼                   ▼                          ▼
 ┌─────────────────────────── API Server (Fastify) ───────────────────────────┐
 │  auth · rooms · runs · rate limiter · y-websocket server · socket.io       │
 └───────┬───────────────────────┬──────────────────────────┬─────────────────┘
         │ Prisma                │ BullMQ enqueue            │ Redis Pub/Sub (subscribe run results)
         ▼                       ▼                           ▲
    PostgreSQL               Redis  ───────────────►  Worker service(s)
                                                       │ dockerode
                                                       ▼
                                             Ephemeral sandbox container
                                             (no network, CPU/mem/time limits)
```

**Run flow:**
1. Client `POST /api/rooms/:roomId/runs` with `{ language, code }`.
2. API validates, checks rate limit, creates `Run` row (`QUEUED`), enqueues BullMQ job, returns `{ runId }` (HTTP 202).
3. Worker picks job → sets `RUNNING` → runs container → captures output.
4. Worker updates `Run` row (`SUCCESS | ERROR | TIMEOUT`) and publishes result to Redis channel `run:results`.
5. API server subscribed to that channel emits `run:update` to the Socket.IO room → all users see output.

Workers must be **stateless and horizontally scalable** (running 3 workers must just work).

---

## 4. Folder Structure

```
codesync/
├── apps/
│   ├── web/            # React frontend
│   ├── server/         # Fastify API + y-websocket + Socket.IO
│   └── worker/         # BullMQ consumer + Docker sandbox runner
├── packages/
│   └── shared/         # Zod schemas, TS types, constants (languages, limits)
├── sandbox-images/     # Dockerfiles for runner images (python, node, cpp)
├── load-tests/         # k6 scripts
├── docs/               # architecture diagram, design decisions
├── docker-compose.yml
├── .env.example
├── .github/workflows/ci.yml
└── README.md
```

---

## 5. Data Models (Prisma)

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String
  passwordHash String
  createdAt    DateTime @default(now())
  rooms        RoomMember[]
  runs         Run[]
}

model Room {
  id        String   @id @default(cuid())
  name      String
  language  Language @default(PYTHON)
  ownerId   String
  createdAt DateTime @default(now())
  members   RoomMember[]
  runs      Run[]
  snapshot  DocSnapshot?
}

model RoomMember {
  userId   String
  roomId   String
  role     Role     @default(EDITOR)
  joinedAt DateTime @default(now())
  user     User @relation(fields: [userId], references: [id])
  room     Room @relation(fields: [roomId], references: [id], onDelete: Cascade)
  @@id([userId, roomId])
}

model DocSnapshot {
  roomId    String   @id
  state     Bytes    // Y.encodeStateAsUpdate(doc)
  updatedAt DateTime @updatedAt
  room      Room @relation(fields: [roomId], references: [id], onDelete: Cascade)
}

model Run {
  id         String    @id @default(cuid())
  roomId     String
  userId     String
  language   Language
  code       String
  status     RunStatus @default(QUEUED)
  stdout     String?
  stderr     String?
  exitCode   Int?
  durationMs Int?
  createdAt  DateTime  @default(now())
  finishedAt DateTime?
  room       Room @relation(fields: [roomId], references: [id], onDelete: Cascade)
  user       User @relation(fields: [userId], references: [id])
  @@index([roomId, createdAt])
}

enum Language  { PYTHON JAVASCRIPT CPP }
enum Role      { OWNER EDITOR VIEWER }
enum RunStatus { QUEUED RUNNING SUCCESS ERROR TIMEOUT }
```

---

## 6. API Contract

All request/response bodies validated with Zod schemas from `packages/shared`.
Errors always return `{ error: { code: string, message: string } }`.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/signup` | – | Create user, set cookie |
| POST | `/api/auth/login` | – | Login, set cookie |
| POST | `/api/auth/logout` | ✓ | Clear cookie |
| GET | `/api/auth/me` | ✓ | Current user |
| POST | `/api/rooms` | ✓ | Create room (caller = OWNER) |
| GET | `/api/rooms` | ✓ | List my rooms |
| GET | `/api/rooms/:roomId` | ✓ member | Room details + members |
| POST | `/api/rooms/:roomId/join` | ✓ | Join via link (becomes EDITOR) |
| PATCH | `/api/rooms/:roomId` | ✓ owner | Rename / change language |
| POST | `/api/rooms/:roomId/runs` | ✓ editor+ | Enqueue run → `202 { runId }` |
| GET | `/api/rooms/:roomId/runs?limit=20` | ✓ member | Run history |
| GET | `/api/runs/:runId` | ✓ member | Single run (polling fallback) |
| GET | `/health` | – | Liveness |
| GET | `/ready` | – | DB + Redis reachable |

**WebSocket:**
- `ws://.../yjs/:roomId` — y-websocket. Authenticate via cookie during upgrade; reject non-members. VIEWER connections are read-only (drop their updates).
- Socket.IO events:
  - client → `room:join { roomId }`
  - server → `run:update { runId, status, stdout?, stderr?, exitCode?, durationMs?, userName }`
  - server → `room:presence { users: [{ id, name, color }] }`

---

## 7. Sandbox Execution Rules (security-critical)

Every run creates a **fresh container** and destroys it afterward. Required Docker settings:

- `NetworkMode: "none"`
- `Memory: 128MB`, `MemorySwap: 128MB`
- `NanoCpus: 0.5 CPU`
- `PidsLimit: 64` (fork-bomb protection)
- `ReadonlyRootfs: true`, writable `tmpfs` at `/tmp` (size 16MB)
- Run as non-root user (`User: "1000:1000"`)
- `CapDrop: ["ALL"]`, `SecurityOpt: ["no-new-privileges"]`
- Wall-clock timeout **5 s** → kill container → status `TIMEOUT`
- Truncate stdout/stderr to **64 KB** each
- Code size limit **50 KB** (reject at API with 413)
- `AutoRemove: true` + worker cleans leftovers on startup

Runner images (in `sandbox-images/`): `python:3.12-alpine`, `node:20-alpine`, `gcc:13` (compile then run, compile counts toward the timeout). Code is passed via stdin or a tmpfs file, **never** via shell string interpolation.

Worker config: BullMQ concurrency from env (`WORKER_CONCURRENCY`, default 2), 1 retry only for infrastructure errors (not for user code errors), jobs removed after completion (history lives in Postgres).

---

## 8. Rate Limiting & Abuse Protection

- Runs: **10 per minute per user** (Redis sliding window). Exceed → `429` with `Retry-After`.
- Auth endpoints: 5 attempts/min per IP.
- Global queue guard: if queue length > `MAX_QUEUE_LENGTH` (default 500), return `503` for new runs.
- Implement the limiter yourself as a Fastify plugin (don't just use a library) and unit test it.

---

## 9. Frontend Requirements

Pages: `/login`, `/signup`, `/dashboard` (my rooms + create), `/room/:roomId`.

Room page layout:
- Top bar: room name, language dropdown (owner only), **Copy invite link**, avatars of online users.
- Left: Monaco editor bound to Yjs (`y-monaco`), remote cursors colored per user (Yjs awareness).
- Right/bottom: Output panel with tabs **Output** and **History**; shows status badge (Queued → Running → Success/Error/Timeout), who ran it, duration.
- **Run** button (Ctrl/Cmd+Enter), disabled while the user's own run is in flight; shows toast on 429.
- Connection indicator (connected / reconnecting). Editor must keep working offline and sync on reconnect (Yjs handles this — verify it).

Keep UI clean and minimal; dark theme by default.

---

## 10. Build Phases

Do **one phase at a time**. At the end of each phase: run lint + typecheck + tests, and summarize what was done.

### Phase 1 — Foundation
- Monorepo, TS configs, ESLint/Prettier, docker-compose (Postgres, Redis), Prisma schema + migration, `.env.example`.
- Auth endpoints + frontend login/signup/dashboard.
- **Accept:** user can sign up, log in, create a room, see it in dashboard. Auth routes have integration tests.

### Phase 2 — Real-time Collaboration
- y-websocket server inside API with cookie auth on upgrade, membership check, viewer read-only.
- Persist Yjs doc to `DocSnapshot` (debounced every 5 s + on last client disconnect); load on first connect.
- Monaco + y-monaco + awareness cursors, presence list.
- **Accept:** two browsers in same room see each other's edits and cursors in < 200 ms locally; server restart doesn't lose code.

### Phase 3 — Execution Engine
- Sandbox images, worker service, BullMQ queue, Run lifecycle, Redis pub/sub → Socket.IO broadcast.
- **Accept:** Python/JS/C++ hello world works; `while True: pass` → TIMEOUT in ~5 s; `import urllib; urlopen(...)` fails (no network); fork bomb doesn't hurt host; output shown to all room members. Worker has tests for the runner (can use a real Docker in CI).

### Phase 4 — Hardening
- Rate limiter plugin, queue guard, input limits, structured logging (pino) with request IDs, graceful shutdown (API + worker drain jobs), `/health` + `/ready`.
- Run history tab.
- **Accept:** 11th run in a minute returns 429; killing a worker mid-job doesn't lose the job permanently.

### Phase 5 — Scale & Measure
- Run 3 worker replicas via compose (`deploy.replicas` or scale flag).
- k6 scripts in `load-tests/`: (a) 200 run requests/min, (b) 50 concurrent WebSocket clients in one room.
- Record results (throughput, p50/p95 latency, error rate) in `docs/benchmarks.md`.
- Optional: Prometheus metrics endpoint (`prom-client`) — queue depth, run duration histogram.
- **Accept:** benchmark numbers documented with setup details.

### Phase 6 — Polish & Ship
- GitHub Actions CI (lint, typecheck, unit + integration tests with Postgres/Redis services).
- 1–2 Playwright E2E tests (two users edit + run).
- Deploy (e.g., API + worker on a VM/EC2 with Docker, Postgres + Redis managed or in compose, frontend on Vercel/Netlify). Worker **must** run on a host where Docker is available.
- README (see §12).

---

## 11. Code Quality Rules (for the agent)

- TypeScript strict, no `any` unless justified with a comment.
- Shared types/schemas only in `packages/shared` — never duplicate.
- Config only from env vars, validated with Zod at startup; fail fast if missing.
- No secrets in code or git. Provide `.env.example`.
- Small, focused modules: routes → services → repositories. No business logic in route handlers.
- Every bug-prone piece (rate limiter, run state machine, sandbox options builder, auth) has tests.
- Meaningful commit messages per feature (`feat(worker): add timeout handling`).
- Don't add features outside this spec without asking. If something in the spec is unclear or impossible, stop and ask.

---

## 12. README Must Include

1. One-line pitch + GIF/screenshot + live demo link.
2. Architecture diagram (from `docs/`) and the run-flow explanation.
3. **Design decisions & trade-offs** section, e.g.:
   - Why CRDT (Yjs) over OT.
   - Why a queue + separate workers instead of executing in the API process.
   - Why a fresh container per run (security vs. latency trade-off) and ideas to improve (warm container pool, gVisor/Firecracker).
   - Why Redis pub/sub for fan-out across multiple API instances.
4. Security measures of the sandbox (list from §7).
5. Benchmark results table.
6. Local setup in ≤ 5 commands (`pnpm i`, `docker compose up -d`, `pnpm db:migrate`, `pnpm build:sandbox`, `pnpm dev`).
7. Future improvements.

---

## 13. Definition of Done

- [ ] All 6 phases' acceptance criteria pass.
- [ ] CI green.
- [ ] Deployed and publicly accessible demo.
- [ ] README complete with diagram, trade-offs, and benchmark numbers.
- [ ] I (the developer) can explain every design decision without looking at the code.
