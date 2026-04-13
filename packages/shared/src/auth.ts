import { z } from "zod";

export const sessionSchema = z.object({
  login: z.string().trim().min(1),
  name: z.string().nullable(),
  avatarUrl: z.string().url().nullable(),
  expiresAt: z.string()
});

export const sessionResponseSchema = z.object({
  authenticated: z.boolean(),
  user: sessionSchema.omit({ expiresAt: true }).nullable()
});

export type Session = z.infer<typeof sessionSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

