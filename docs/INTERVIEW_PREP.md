# CodeSync: interview prep

> **Is file ko kaise use karein:** pehle Section 1 (pitch) ratt lo, phir Section 2 ka diagram khud kaagaz par 3 baar banao. Uske baad Section 3 ke sawal: har jawab pehle khud bolo, phir yahan match karo. Answers English mein hain kyunki interview English mein hoga. Simple words use karo, jaise yahan likhe hain.

---

## 1. The 60-second pitch (memorise this)

> "CodeSync is a real-time collaborative code editor, like Google Docs for code, with a Run button.
> Multiple people join a room from a link and edit the same file. You see each other's cursors live.
> When someone clicks Run, the code runs in an isolated Docker container and everyone in the room sees the output.
>
> For the editing I used **Yjs, a CRDT**, so concurrent edits merge automatically, even offline.
> For execution, the API doesn't run code itself. It puts a job on a **Redis queue (BullMQ)**, and separate **stateless worker services** pick it up.
> Each run gets a **brand-new container** with no network, 128 MB of memory, half a CPU and a 5-second timeout.
> Results go back through **Redis pub/sub** to every API server and reach browsers through **Socket.IO**.
>
> It's TypeScript end to end: React and Monaco on the front end, Fastify with Postgres and Prisma on the back end.
> It has 86 automated tests, including sandbox tests against real Docker, an end-to-end test with two browsers, and k6 load tests.
> At 200 runs a minute, p95 turnaround was 240 ms with zero errors."

## 2. Draw this on a whiteboard

```
Browser ──REST──────────► API (Fastify) ──► Postgres
   │   ──WS /yjs (CRDT)──►   │  ▲
   │   ──WS Socket.IO────►   │  │ SUBSCRIBE run:results
   │                         ▼  │
   │                      Redis (queue + pub/sub)
   │                         │  ▲ PUBLISH result
   │                         ▼  │
   │                      Worker ×3 ──dockerode──► fresh container per run
   ◄──────── run:update (Socket.IO) ─────────────
```

Explain it in order: **request → validate → save QUEUED → enqueue → 202 → worker → container → save result → publish → every API → Socket.IO → all browsers.**

## 3. Questions you will get (with answers)

### A. Architecture

**Q1. Why not just run the code inside the API server?**
Three reasons:

1. **Performance isolation.** Running code is slow and CPU-heavy. If the API did it, a burst of runs would slow down login and editing for everyone. Now the API only does an insert plus an enqueue, which is 16 ms at p95.
2. **Security.** Only workers need access to Docker. The API, which faces the internet, doesn't.
3. **Scaling and back-pressure.** Workers are stateless, so I scale by adding more. If demand is higher than capacity, jobs wait in the queue instead of failing. My stress test showed that: at 1,200 requests/min the system saturated at ~620/min, but nothing failed.

**Q2. Why return 202 and not 200?**
202 means "Accepted, but not finished yet". The run happens later, asynchronously. The client gets a `runId` and then receives updates over Socket.IO, or polls `GET /api/runs/:id` as a fallback.

**Q3. What happens if you run 2 API servers?**
REST works, because the API is stateless: the JWT is in a cookie and all data is in Postgres/Redis. For run results, the worker publishes once to Redis, and **every** API instance is subscribed, so each one forwards to the users connected to it. That is why I used pub/sub.
Two honest limits:

- The **presence list** is per instance today. The fix is the Socket.IO Redis adapter.
- The **Yjs document** for a room lives in memory on one instance. With multiple instances you'd either route all users of a room to the same instance (sticky by roomId) or sync docs between instances through Redis (y-redis).

**Q4. Why two WebSocket connections (Yjs and Socket.IO)?**
They carry different things. Yjs uses a compact binary protocol for document sync, and the y-websocket client expects exactly that format. Socket.IO carries JSON app events (run status, presence) and gives me rooms, acks and auto-reconnect. Keeping them separate keeps each one simple.

**Q5. Why a monorepo with a `shared` package?**
The same Zod schemas validate requests on the server and parse responses on the client, so types can't drift apart. If I change a field, TypeScript breaks the build on both sides.

### B. Real-time collaboration (CRDT)

**Q6. What is a CRDT? Why not OT?**
CRDT means Conflict-free Replicated Data Type. Every edit gets a unique ID and a position relative to other characters, not a plain index. So when two people type at the same place at the same time, every copy merges to **the same result, in any order**, with no central coordinator.
OT (Operational Transformation, used by Google Docs) instead transforms operations against each other on a central server. It's hard to implement correctly and needs that server for every operation.
With a CRDT I get **offline editing** for free and a **dumb server** that just relays and stores updates.

**Q7. What does the server do with edits?**
It keeps one `Y.Doc` per active room in memory. When a client sends an update, the server applies it and broadcasts it to the other clients in that room. It saves a snapshot (`Y.encodeStateAsUpdate`) to Postgres at most once every 5 seconds, and immediately when the last person leaves. When someone connects later, it loads the snapshot.

**Q8. What if the server crashes?**
You lose at most ~5 seconds of edits, because of the throttled save. And the clients still have the full document locally. When they reconnect, Yjs sync sends the server whatever it is missing, so in practice nothing is lost as long as one client was open. There's a test that restarts the server and checks the code is still there.

**Q9. How do live cursors work?**
With Yjs **awareness**, a separate lightweight channel for temporary state (cursor position, name, colour). It isn't saved to the database. When a socket disconnects, the server removes that user's awareness state so their cursor disappears.

**Q10. How is a VIEWER read-only?**
Two layers. The UI sets Monaco to `readOnly`. The real protection is on the server: for a viewer's connection, the Yjs server answers "send me the document" requests but **drops any updates** they send. There's a test where a viewer edits and the owner never sees it. Never trust the client.

**Q11. How did you authenticate WebSockets?**
During the HTTP **upgrade** request the browser sends the auth cookie automatically. Before accepting the socket, I verify the JWT and check room membership. I reply `401` or `403` and close the connection if either check fails.

### C. Sandboxed execution

**Q12. How do you make running untrusted code safe?**
Each run gets a **fresh container** that is destroyed afterwards, with:

- **no network**
- **128 MB memory and no swap**
- **half a CPU**
- a **limit of 64 processes**, against fork bombs
- a **read-only filesystem**, except a small 16 MB `/tmp`
- a **non-root user**
- **all Linux capabilities dropped** and `no-new-privileges`
- a **5-second timeout**, then SIGKILL
- output capped at 64 KB
- code passed through **stdin**, never through a shell command

I have tests against real Docker for timeout, no network, fork bomb, memory limit, read-only FS and non-root.

**Q13. Is a Docker container fully secure?**
No, and I'd say that honestly. Containers share the host's kernel, so a kernel bug could let code escape. For stronger isolation I'd use **gVisor**, which intercepts system calls in user space, or **Firecracker** micro-VMs, which AWS Lambda uses. Also, the worker has access to the Docker socket, which is root-level on that machine. So in production, workers should run on separate hosts, ideally behind a socket proxy that only allows create, start and kill.

**Q14. Why a fresh container for every run? Isn't that slow?**
It's a **security vs latency trade-off**. Fresh means nothing leaks between users. The cost is ~100–200 ms of container start-up. My p50 turnaround was 217 ms. To improve it I'd keep a **warm pool** of pre-created containers, so each run still gets its own container but doesn't wait for it to start.

**Q15. How does the timeout work?**
The worker starts the container, then races "container exited" against a 5-second timer. If the timer wins, it SIGKILLs the container and marks the run `TIMEOUT`. For C++ the compile time counts too.

**Q16. What if a worker crashes in the middle of a run?**
BullMQ holds a **lock** on the job while a worker is processing it. If the worker dies, the lock expires, BullMQ marks the job as "stalled" and puts it back, and another worker picks it up. I tested this by killing a worker with SIGKILL mid-run, and the job finished on another worker. The container the dead worker left behind is cleaned up by a periodic sweep that removes sandbox containers older than 30 seconds.

**Q17. When do you retry a job?**
Only for **infrastructure errors**, like Docker or the database being down. Then the worker throws and BullMQ retries once. If the user's code has an error, that's a normal result (`ERROR` with stderr), not an exception, so no retry. Retrying broken user code would just waste resources.

**Q18. How do you stop two workers from both finishing the same run?**
Every status change is a **conditional update**: `UPDATE run SET status='SUCCESS' WHERE id=? AND status='RUNNING'`. Finished states can never change again. If two workers race, only one update matches a row, and the loser sees "0 rows updated" and doesn't publish. The allowed transitions are defined once in a small state machine that has unit tests.

### D. Rate limiting & reliability

**Q19. How does your rate limiter work?**
It's a **sliding window log** in Redis. For each user I keep a sorted set of the timestamps of their recent requests. On each request:

1. Remove timestamps older than 60 seconds.
2. Count what's left.
3. If the count is under 10, add the new timestamp and allow the request. Otherwise return **429** with `Retry-After`.

All of this runs in one **Lua script**, so it's **atomic**: two parallel requests can't both see "9" and both get in. There's a test that fires 25 parallel requests and exactly 10 pass. It also uses Redis's clock, so multiple API servers agree on the time.

**Q20. Why sliding window and not fixed window?**
With a fixed window (per clock minute), a user can make 10 requests at 0:59 and 10 more at 1:00: that's 20 in 2 seconds. A sliding window always looks at the **last 60 seconds**, so that burst isn't possible.

**Q21. What if Redis is down?**
The limiter **fails open**: requests are allowed and the error is logged. I chose availability, because blocking every user due to a limiter outage is worse. For auth endpoints under attack you might choose fail-closed instead; it's a config choice.

**Q22. What is the queue guard?**
If more than 500 jobs are waiting, new runs get **503** with `Retry-After`. That's load shedding: better to say "busy, try again" quickly than to let waits grow forever.

**Q23. What does graceful shutdown mean here?**
On SIGTERM:

- **The API** stops accepting connections, closes WebSockets, saves every open document to Postgres, then closes Redis and the DB.
- **The worker** stops taking new jobs and waits for its running jobs to finish before exiting.

That way a deploy doesn't lose work.

### E. Backend, database & security basics

**Q24. How does login work?**

- The password is hashed with **bcrypt**, which is slow on purpose and salted, so leaked hashes are hard to crack.
- On login I create a **JWT** and put it in an **httpOnly cookie**. JavaScript on the page can't read it, so an XSS bug can't steal it.
- The cookie is `SameSite=Lax`, which blocks most CSRF.
- Wrong password and unknown email return the **same error and take the same time** (I compare against a dummy hash), so attackers can't find out which emails exist.

**Q25. How did you structure the backend code?**
**Routes → services → repositories.**

- Routes only parse input (Zod) and send the response.
- Services hold the business rules (roles, limits).
- Repositories hold the Prisma queries.

Dependencies are injected in one place (`app.ts`), so tests can swap the real queue for a fake one. Config comes from env vars validated with Zod at startup, and the app refuses to start if something is missing.

**Q26. Any database design choices?**

- An index on `Run(roomId, createdAt)`, because run history is always "latest runs of this room".
- The composite primary key `(userId, roomId)` on `RoomMember`, so someone can't be a member twice.
- `onDelete: Cascade` from Room, so deleting a room cleans up its runs and snapshot.
- Email is `UNIQUE`, and I rely on the database constraint rather than "check then insert", which would have a race.

### F. Testing

**Q27. How did you test it?**

- **Unit tests**: state machine, rate-limit algorithm, sandbox options builder, output capping.
- **Integration tests** against real Postgres and Redis: every auth route, roles, the 413/429/503 cases, Yjs sync between two clients, persistence after a restart.
- **Real-Docker tests** for the sandbox.
- **Playwright E2E**: two browsers edit the same file, one clicks Run, both see the output.
- **k6 load tests**: 200 runs/min, and 50 WebSocket clients in one room.
- **CI** on GitHub Actions runs lint, typecheck and all tests with Postgres and Redis as services.

### G. Behavioural / "tell me about…"

**Q28. What was the hardest bug?** (pick one and tell it as a story)

- **Stdin corruption.** Sometimes Python programs failed with a syntax error that made no sense. I printed stderr and saw a JSON string, `{"stream":true,...}`, glued before the user's code. The Docker client library sends its options as an HTTP request body, and Docker was forwarding those bytes into the container's stdin. It was timing-dependent, so it happened only sometimes. I fixed it by framing the input: the worker sends a marker line, and the container ignores everything before it. I added a regression test that runs `sys.exit(3)` five times and checks the exit code is exactly 3.
- **Race condition on join.** My E2E test failed because opening an invite link called "join" twice at the same time (React StrictMode runs effects twice in development). Both requests tried to insert the membership row, and the second hit a unique-key error, which became a 500. I made join idempotent: if the insert loses the race, just read the existing row. I added a test that sends 5 joins in parallel.

- **Out-of-order updates.** While recording a demo, one browser showed "Queued" while the other showed "Running" for the same run. The HTTP 202 response reached the browser _after_ the worker's "RUNNING" event over the socket, and my code overwrote the newer status with the older one. If a run finished very fast, the Run button could even stay disabled. The fix: a run's status may only move forward (QUEUED → RUNNING → finished), never backwards. The rule is a small tested function in the shared package. Lesson: over a network, messages from different channels can arrive in any order.

**Q29. What would you improve next?**

1. A warm container pool for latency.
2. gVisor for stronger isolation.
3. The Socket.IO Redis adapter so presence is global.
4. Prometheus metrics for queue depth and run duration.
5. Deploying workers on separate machines.

**Q30. Did you use AI to build this?**
Be honest. Suggested answer:

> "Yes, I built it with an AI assistant, the same way many teams use Copilot or Claude now. I wrote the spec and the acceptance criteria, and I drove the design decisions: CRDT vs OT, the queue architecture, the security model. I also verified everything with tests and benchmarks. The AI sped up the typing. I debugged real issues, like the stdin corruption and the join race, and I can walk you through any file."

**Only say this if it's true, so read the code before the interview.** At minimum, understand these 6 files:

| File                                           | What to understand                           |
| ---------------------------------------------- | -------------------------------------------- |
| `apps/server/src/modules/runs/runs.service.ts` | the order of checks before enqueueing        |
| `apps/server/src/plugins/rate-limit/store.ts`  | the Lua sliding-window script                |
| `apps/server/src/realtime/yjs/yjs-server.ts`   | upgrade auth, viewer read-only, close → save |
| `apps/worker/src/sandbox/options.ts`           | every security flag                          |
| `apps/worker/src/sandbox/runner.ts`            | create → attach → start → wait vs timeout    |
| `packages/shared/src/run-state.ts`             | the state machine                            |

## 4. Numbers to remember

|                      |                                                                       |
| -------------------- | --------------------------------------------------------------------- |
| Sandbox limits       | 128 MB · 0.5 CPU · 64 processes · 5 s · 64 KB output · 50 KB code     |
| Rate limits          | 10 runs/min/user · 5 auth attempts/min/IP · queue guard at 500        |
| Snapshot save        | every 5 s while editing + when last person leaves                     |
| 200 runs/min test    | 600/600 succeeded · p95 turnaround **240 ms** · enqueue p95 **16 ms** |
| Capacity             | ~**620 runs/min** with 3 workers × 2 slots on a laptop                |
| 50 WebSocket clients | broadcast p95 **68 ms** · ~2,270 msgs/s                               |
| Tests                | 86 automated + 2 E2E                                                  |

## 5. Glossary (one line each)

- **CRDT**: data structure where copies edited separately always merge to the same result.
- **OT**: the older approach; a central server transforms concurrent operations.
- **Awareness (Yjs)**: temporary shared state like cursors; not saved.
- **Pub/Sub**: publisher sends a message to a channel; every subscriber gets it.
- **Message queue**: a list of jobs; workers take one at a time; decouples producers from consumers.
- **Stateless service**: keeps no data in memory between requests, so you can run many copies.
- **Back-pressure / load shedding**: when overloaded, slow down or reject early instead of collapsing.
- **Idempotent**: doing it twice has the same effect as once (e.g. join room, `jobId = runId`).
- **Sliding window**: rate limit over the last N seconds, not per clock minute.
- **Atomic**: happens completely or not at all; nothing can run in between (the Lua script).
- **Stalled job**: a job whose worker stopped renewing its lock (crashed); BullMQ re-queues it.
- **httpOnly cookie**: cookie JavaScript can't read; protects tokens from XSS.
- **SameSite cookie**: the browser won't send it on most cross-site requests; protects against CSRF.
- **cgroups / namespaces**: Linux features that Docker uses to limit and isolate containers.
- **gVisor / Firecracker**: stronger sandboxes: a user-space kernel / tiny VMs.
- **p50 / p95**: 50 % / 95 % of requests were faster than this value.
