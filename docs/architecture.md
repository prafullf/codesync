# Architecture

## System diagram

```mermaid
flowchart TB
  subgraph Browser["Browser (React + Monaco + Yjs)"]
    UI[Room page]
  end

  subgraph API["API server (Fastify), stateless, can run N copies"]
    REST[REST routes<br/>auth · rooms · runs]
    RL[Rate limiter plugin]
    YWS[Yjs WebSocket server<br/>/yjs/:roomId]
    SIO[Socket.IO<br/>presence · run:update]
  end

  PG[(PostgreSQL<br/>users · rooms · runs · doc snapshots)]
  RD[(Redis<br/>BullMQ queue · pub/sub · rate-limit windows)]

  subgraph Workers["Worker service, stateless, 3 replicas"]
    W[BullMQ consumer]
  end

  SB[[Fresh sandbox container per run<br/>no network · 128 MB · 0.5 CPU · 5 s]]

  UI -- "HTTP /api" --> REST
  UI -- "WS binary CRDT sync" --> YWS
  UI -- "WS events" --> SIO
  REST --> RL --> RD
  REST -- Prisma --> PG
  YWS -- "snapshot every 5 s + on last disconnect" --> PG
  REST -- "enqueue {runId}" --> RD
  RD -- "job" --> W
  W -- dockerode --> SB
  W -- "status + output" --> PG
  W -- "PUBLISH run:results" --> RD
  RD -- "SUBSCRIBE run:results" --> SIO
  SIO -- "run:update" --> UI
```

## Run flow

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser (runner)
  participant O as Other browsers in room
  participant A as API
  participant R as Redis
  participant W as Worker
  participant D as Docker
  participant P as Postgres

  B->>A: POST /api/rooms/:id/runs {language, code}
  A->>A: auth · role ≥ EDITOR · rate limit · size ≤ 50 KB · queue guard
  A->>P: INSERT Run (QUEUED)
  A->>R: queue.add({runId})
  A->>R: PUBLISH run:results (QUEUED)
  A-->>B: 202 {runId}
  R-->>A: message → Socket.IO room → B, O see "Queued"
  W->>R: take job
  W->>P: UPDATE Run SET RUNNING WHERE status IN (QUEUED, RUNNING)
  W->>R: PUBLISH (RUNNING)
  W->>D: create + attach + start (code via stdin)
  D-->>W: stdout / stderr / exit code (or kill at 5 s)
  W->>P: UPDATE Run SET SUCCESS|ERROR|TIMEOUT WHERE status = RUNNING
  W->>R: PUBLISH (final result)
  R-->>A: message → Socket.IO → B and O see the output
```

## Run state machine

```mermaid
stateDiagram-v2
  [*] --> QUEUED
  QUEUED --> RUNNING: worker claims
  QUEUED --> ERROR: infra failure after retries
  RUNNING --> RUNNING: job re-picked after a worker crash
  RUNNING --> SUCCESS: exit 0
  RUNNING --> ERROR: non-zero exit / compile error / OOM
  RUNNING --> TIMEOUT: killed at 5 s
  SUCCESS --> [*]
  ERROR --> [*]
  TIMEOUT --> [*]
```

The state machine is defined once in `packages/shared/src/run-state.ts`. The worker enforces it in the database with conditional updates (`UPDATE … WHERE status IN (<legal sources>)`), so a duplicate or late message can never overwrite a finished run, even with many workers.

## Real-time document sync

- Each room has one `Y.Doc` in the API process while anyone is connected. The editor text is a `Y.Text` named `monaco`.
- The browser binds Monaco to that `Y.Text` with `y-monaco`. Edits are applied locally first (so there's no typing lag), then sent as tiny binary updates.
- The server is a y-websocket-compatible implementation (`apps/server/src/realtime/yjs`) with additions the reference server doesn't have:
  - **Cookie auth during the HTTP upgrade**: no valid JWT → `401`, not a member → `403`, before any WebSocket is opened.
  - **Read-only viewers**: sync-step-1 ("send me the doc") is answered; their updates are dropped.
  - **Persistence**: `Y.encodeStateAsUpdate(doc)` is written to `DocSnapshot`, throttled to once per 5 s while edits flow, and immediately when the last client leaves. The next connection loads it, so a server restart loses at most ~5 s of edits.
  - **Starter code** is inserted on the server when a room's doc is first created. There is exactly one writer, so two clients can't both insert it.
- Cursors and presence use Yjs **awareness**. It is ephemeral, never persisted, and cleaned up when a socket closes.

## Why two WebSocket channels?

|                 | Yjs WebSocket (`/yjs/:roomId`) | Socket.IO                                |
| --------------- | ------------------------------ | ---------------------------------------- |
| Carries         | CRDT document updates, cursors | run status, presence list, room settings |
| Format          | compact binary (y-protocols)   | JSON events                              |
| Source of truth | the in-memory `Y.Doc`          | Postgres + Redis pub/sub                 |

They are separate so each protocol stays simple: y-websocket clients expect the exact Yjs wire format, and app events benefit from Socket.IO's rooms, acks and reconnection.

## Code layout

```
apps/server/src
├── config/env.ts            # Zod-validated env, fail fast
├── app.ts                   # composition root (wires repos → services → routes)
├── modules/<feature>/       # routes → service → repository
├── plugins/                 # auth guard, error handler, rate limiter
└── realtime/                # Yjs server, Socket.IO
apps/worker/src
├── sandbox/options.ts       # the security policy, one pure (tested) function
├── sandbox/runner.ts        # create → attach → start → wait/kill → collect
├── jobs/                    # job processing + conditional DB updates
└── index.ts                 # BullMQ worker, graceful drain, leftover cleanup
packages/shared              # Zod schemas, types, constants, run state machine
packages/db                  # Prisma schema, migrations, client
```
