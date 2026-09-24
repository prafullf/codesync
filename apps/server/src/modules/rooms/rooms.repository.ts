import { Prisma, type Language, type PrismaClient, type Role, type Room, type RoomMember } from '@codesync/db';

export type RoomWithRole = Room & { role: Role };
export type RoomWithMembers = Room & {
  members: (RoomMember & { user: { name: string } })[];
};

export class RoomRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Room + owner membership in one transaction so a room never exists without an owner. */
  createWithOwner(input: { name: string; language: Language; ownerId: string }): Promise<Room> {
    return this.prisma.room.create({
      data: {
        name: input.name,
        language: input.language,
        ownerId: input.ownerId,
        members: { create: { userId: input.ownerId, role: 'OWNER' } },
      },
    });
  }

  async listForUser(userId: string): Promise<RoomWithRole[]> {
    const memberships = await this.prisma.roomMember.findMany({
      where: { userId },
      include: { room: true },
      orderBy: { room: { createdAt: 'desc' } },
    });
    return memberships.map((m) => ({ ...m.room, role: m.role }));
  }

  findById(roomId: string): Promise<Room | null> {
    return this.prisma.room.findUnique({ where: { id: roomId } });
  }

  findByIdWithMembers(roomId: string): Promise<RoomWithMembers | null> {
    return this.prisma.room.findUnique({
      where: { id: roomId },
      include: {
        members: { include: { user: { select: { name: true } } }, orderBy: { joinedAt: 'asc' } },
      },
    });
  }

  async getRole(userId: string, roomId: string): Promise<Role | null> {
    const member = await this.prisma.roomMember.findUnique({
      where: { userId_roomId: { userId, roomId } },
      select: { role: true },
    });
    return member?.role ?? null;
  }

  /**
   * Idempotent: joining twice keeps the existing role. Two concurrent joins can
   * both miss the row and race to insert; the loser gets P2002 and just reads it.
   */
  async addMember(userId: string, roomId: string, role: Role): Promise<Role> {
    try {
      const member = await this.prisma.roomMember.upsert({
        where: { userId_roomId: { userId, roomId } },
        create: { userId, roomId, role },
        update: {},
        select: { role: true },
      });
      return member.role;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.getRole(userId, roomId);
        if (existing) return existing;
      }
      throw err;
    }
  }

  update(roomId: string, data: { name?: string; language?: Language }): Promise<Room> {
    return this.prisma.room.update({ where: { id: roomId }, data });
  }
}
