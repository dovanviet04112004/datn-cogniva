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
