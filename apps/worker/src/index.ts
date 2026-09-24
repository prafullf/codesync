import Docker from 'dockerode';
import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { createPrismaClient } from '@codesync/db';
import { RUN_QUEUE_NAME, RUN_RESULTS_CHANNEL, runJobDataSchema, type RunJobData } from '@codesync/shared';
import { loadWorkerEnv } from './config';
import { failRun, processRun, type ProcessRunDeps } from './jobs/process-run';
import { WorkerRunRepository } from './jobs/run.repository';
import { removeStaleSandboxes } from './sandbox/cleanup';
import { DockerSandboxRunner } from './sandbox/runner';

const CLEANUP_INTERVAL_MS = 60_000;

async function main(): Promise<void> {
  const env = loadWorkerEnv();
  const log = pino({
    level: env.LOG_LEVEL,
    ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
  });

  const docker = new Docker(env.DOCKER_SOCKET_PATH ? { socketPath: env.DOCKER_SOCKET_PATH } : undefined);
  await docker.ping(); // fail fast if Docker is not reachable

  const prisma = createPrismaClient(env.DATABASE_URL);
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const publisher = new Redis(env.REDIS_URL);

  const deps: ProcessRunDeps = {
    runs: new WorkerRunRepository(prisma),
    runner: new DockerSandboxRunner(docker, { imagePrefix: env.SANDBOX_IMAGE_PREFIX }),
    publish: async (event) => {
      await publisher.publish(RUN_RESULTS_CHANNEL, JSON.stringify(event));
    },
    log,
  };

  const removed = await removeStaleSandboxes(docker);
  if (removed > 0) log.warn({ removed }, 'removed leftover sandbox containers');
  const cleanup = setInterval(() => {
    removeStaleSandboxes(docker).catch((err: unknown) => log.error({ err }, 'sandbox cleanup failed'));
  }, CLEANUP_INTERVAL_MS);

  // Stateless: all state is in Postgres/Redis, so any number of replicas can run this.
  const worker = new Worker<RunJobData>(
    RUN_QUEUE_NAME,
    async (job: Job<RunJobData>) => {
      const { runId } = runJobDataSchema.parse(job.data);
      await processRun(runId, { ...deps, log: log.child({ runId, jobId: job.id, attempt: job.attemptsMade + 1 }) });
    },
    { connection, concurrency: env.WORKER_CONCURRENCY },
  );

  worker.on('failed', (job, err) => {
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    log.error({ err, runId: job.data.runId, attempt: job.attemptsMade, attempts }, 'run job failed');
    // Out of retries (or stalled too often, e.g. its worker kept dying): record the failure.
    if (job.attemptsMade >= attempts || /stalled/i.test(err.message)) {
      failRun(job.data.runId, deps).catch((e: unknown) => log.error({ err: e }, 'could not mark run failed'));
    }
  });
  worker.on('error', (err) => log.error({ err }, 'worker error'));
  log.info({ concurrency: env.WORKER_CONCURRENCY }, 'worker started');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'draining: finishing active jobs, taking no new ones');
    clearInterval(cleanup);
    try {
      await worker.close(); // waits for in-flight jobs to complete
      await Promise.all([connection.quit(), publisher.quit(), prisma.$disconnect()]);
      log.info('worker stopped cleanly');
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
