import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

/**
 * Prisma lives in its own package because both the API server and the worker
 * read/write the same tables; the web app must never pull it into its bundle.
 */
export function createPrismaClient(databaseUrl?: string): PrismaClient {
  return new PrismaClient(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : undefined);
}
