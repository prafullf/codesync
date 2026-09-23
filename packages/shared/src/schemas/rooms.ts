import { z } from 'zod';
import { LANGUAGES, ROLES } from '../constants';

export const languageSchema = z.enum(LANGUAGES);
export const roleSchema = z.enum(ROLES);

export const createRoomBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  language: languageSchema.default('PYTHON'),
});
export type CreateRoomBody = z.infer<typeof createRoomBodySchema>;

export const updateRoomBodySchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    language: languageSchema.optional(),
  })
  .refine((b) => b.name !== undefined || b.language !== undefined, {
    message: 'Provide at least one of name or language',
  });
export type UpdateRoomBody = z.infer<typeof updateRoomBodySchema>;

export const roomSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  language: languageSchema,
  ownerId: z.string(),
  createdAt: z.string(),
  role: roleSchema,
});
export type RoomSummary = z.infer<typeof roomSummarySchema>;

export const roomMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  role: roleSchema,
  joinedAt: z.string(),
});
export type RoomMember = z.infer<typeof roomMemberSchema>;

export const roomDetailsSchema = roomSummarySchema.extend({
  members: z.array(roomMemberSchema),
});
export type RoomDetails = z.infer<typeof roomDetailsSchema>;

export const roomResponseSchema = z.object({ room: roomDetailsSchema });
export const roomListResponseSchema = z.object({ rooms: z.array(roomSummarySchema) });
