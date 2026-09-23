import type { Room } from '@codesync/db';
import type {
  CreateRoomBody,
  Role,
  RoomDetails,
  RoomSummary,
  UpdateRoomBody,
} from '@codesync/shared';
import { errors } from '../../lib/errors';
import type { EventBus } from '../../lib/event-bus';
import { hasAtLeastRole } from './roles';
import type { RoomRepository } from './rooms.repository';

function toSummary(room: Room, role: Role): RoomSummary {
  return {
    id: room.id,
    name: room.name,
    language: room.language,
    ownerId: room.ownerId,
    createdAt: room.createdAt.toISOString(),
    role,
  };
}

export class RoomService {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly events: EventBus,
  ) {}

  async create(userId: string, body: CreateRoomBody): Promise<RoomSummary> {
    const room = await this.rooms.createWithOwner({ ...body, ownerId: userId });
    return toSummary(room, 'OWNER');
  }

  async listMine(userId: string): Promise<RoomSummary[]> {
    const rooms = await this.rooms.listForUser(userId);
    return rooms.map((r) => toSummary(r, r.role));
  }

  async getDetails(userId: string, roomId: string): Promise<RoomDetails> {
    const room = await this.rooms.findByIdWithMembers(roomId);
    if (!room) throw errors.notFound('Room not found');
    const me = room.members.find((m) => m.userId === userId);
    if (!me) throw errors.forbidden('You are not a member of this room');
    return {
      ...toSummary(room, me.role),
      members: room.members.map((m) => ({
        userId: m.userId,
        name: m.user.name,
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
      })),
    };
  }

  /** Anyone with the link can join; new members become EDITORs. */
  async join(userId: string, roomId: string): Promise<RoomDetails> {
    const room = await this.rooms.findById(roomId);
    if (!room) throw errors.notFound('Room not found');
    await this.rooms.addMember(userId, roomId, 'EDITOR');
    return this.getDetails(userId, roomId);
  }

  async update(userId: string, roomId: string, body: UpdateRoomBody): Promise<RoomSummary> {
    await this.requireRole(userId, roomId, 'OWNER');
    const room = await this.rooms.update(roomId, body);
    await this.events.publishRoomUpdate({ id: room.id, name: room.name, language: room.language });
    return toSummary(room, 'OWNER');
  }

  /**
   * Throws 404 if the room does not exist, 403 if the user is not a member or
   * lacks the role. Returns the caller's actual role.
   */
  async requireRole(userId: string, roomId: string, required: Role): Promise<Role> {
    const role = await this.rooms.getRole(userId, roomId);
    if (!role) {
      const exists = await this.rooms.findById(roomId);
      throw exists ? errors.forbidden('You are not a member of this room') : errors.notFound('Room not found');
    }
    if (!hasAtLeastRole(role, required)) {
      throw errors.forbidden(`This action requires the ${required} role`);
    }
    return role;
  }

  getRole(userId: string, roomId: string): Promise<Role | null> {
    return this.rooms.getRole(userId, roomId);
  }
}
