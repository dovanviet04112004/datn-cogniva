/**
 * Zod schemas cho channels voice/stage/collab — copy NGUYÊN VĂN từ route cũ:
 *   voiceStateSchema  ← apps/web/src/app/api/channels/[id]/voice/state/route.ts
 *   stageActionSchema ← .../stage/route.ts (POST raise/lower hand)
 *   collabTokenSchema ← .../collab-token/route.ts
 */
import { z } from 'zod';

export const voiceStateSchema = z.object({
  selfMuted: z.boolean().optional(),
  camera: z.boolean().optional(),
  screenShare: z.boolean().optional(),
});
export type VoiceStateInput = z.infer<typeof voiceStateSchema>;

export const stageActionSchema = z.object({ action: z.enum(['raise', 'lower']) });

export const collabTokenSchema = z.object({
  kind: z.enum(['whiteboard', 'notes', 'code']),
});
