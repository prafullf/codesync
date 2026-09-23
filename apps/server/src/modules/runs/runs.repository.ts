import type { Language, PrismaClient, Run } from '@codesync/db';

export type RunWithUser = Run & { user: { name: string } };

const withUser = { user: { select: { name: true } } } as const;

export class RunRepository {
  constructor(private readonly prisma: PrismaClient) {}

  create(input: { roomId: string; userId: string; language: Language; code: string }): Promise<RunWithUser> {
    return this.prisma.run.create({ data: input, include: withUser });
  }

  findById(runId: string): Promise<RunWithUser | null> {
    return this.prisma.run.findUnique({ where: { id: runId }, include: withUser });
  }

  listByRoom(roomId: string, limit: number): Promise<RunWithUser[]> {
    return this.prisma.run.findMany({
      where: { roomId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: withUser,
    });
  }

  markFailed(runId: string, message: string): Promise<Run> {
    return this.prisma.run.update({
      where: { id: runId },
      data: { status: 'ERROR', stderr: message, finishedAt: new Date() },
    });
  }
}
