import type Docker from 'dockerode';
import { LIMITS } from '@codesync/shared';
import { SANDBOX_LABEL } from './options';

/**
 * Remove sandbox containers left behind by a crashed worker.
 *
 * Only containers older than a safe age are removed: several workers share
 * one Docker daemon, and a younger container may belong to a healthy worker
 * that is running it right now.
 */
export const STALE_AFTER_MS = LIMITS.RUN_TIMEOUT_MS * 6;

export async function removeStaleSandboxes(docker: Docker, now = Date.now()): Promise<number> {
  const containers = await docker.listContainers({
    all: true,
    filters: { label: [`${SANDBOX_LABEL}=true`] },
  });
  const stale = containers.filter((c) => now - c.Created * 1000 > STALE_AFTER_MS);
  await Promise.all(
    stale.map((c) =>
      docker
        .getContainer(c.Id)
        .remove({ force: true })
        .catch(() => undefined),
    ),
  );
  return stale.length;
}
