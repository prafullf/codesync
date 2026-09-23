import type { Language, PrismaClient } from '@codesync/db';

export interface DocPersistence {
  /** Returns null when the room does not exist. */
  load(roomId: string): Promise<{ state: Uint8Array | null; language: Language } | null>;
  save(roomId: string, state: Uint8Array): Promise<void>;
}

export class PrismaDocPersistence implements DocPersistence {
  constructor(private readonly prisma: PrismaClient) {}

  async load(roomId: string) {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { language: true, snapshot: { select: { state: true } } },
    });
    if (!room) return null;
    return { state: room.snapshot ? new Uint8Array(room.snapshot.state) : null, language: room.language };
  }

  async save(roomId: string, state: Uint8Array): Promise<void> {
    const buf = Buffer.from(state);
    await this.prisma.docSnapshot.upsert({
      where: { roomId },
      create: { roomId, state: buf },
      update: { state: buf },
    });
  }
}
