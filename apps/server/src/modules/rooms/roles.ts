import type { Role } from '@codesync/shared';

const RANK: Record<Role, number> = { VIEWER: 0, EDITOR: 1, OWNER: 2 };

/** OWNER satisfies EDITOR, EDITOR satisfies VIEWER, and so on. */
export function hasAtLeastRole(actual: Role, required: Role): boolean {
  return RANK[actual] >= RANK[required];
}
