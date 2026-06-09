import { z } from "zod";

import { contactChannelSchema, contactStatusSchema } from "./listings";

export const contactMessageSchema = z.object({
  subject: z.string().trim().min(1),
  body: z.string().trim().min(1)
});

export const contactMessageJsonSchema = {
  type: "object",
  properties: {
    subject: {
      type: "string",
      description: "Short German email subject line for the rental application."
    },
    body: {
      type: "string",
      description: "Polite formal German application message, roughly 120-180 words, plain text."
    }
  },
  required: ["subject", "body"]
} as const;

export const contactAttemptCreateSchema = z.object({
  channel: contactChannelSchema,
  status: contactStatusSchema.default("SENT"),
  messageSubject: z.string().trim().min(1).nullable().default(null),
  messageBody: z.string().trim().min(1).nullable().default(null),
  errorMessage: z.string().trim().min(1).nullable().default(null)
});

export const contactAttemptSchema = z.object({
  id: z.number().int().positive(),
  listingId: z.number().int().positive(),
  timestamp: z.string(),
  channel: contactChannelSchema,
  status: contactStatusSchema,
  messageSubject: z.string().nullable(),
  messageBody: z.string().nullable(),
  errorMessage: z.string().nullable()
});

export type ContactMessage = z.infer<typeof contactMessageSchema>;
export type ContactAttemptCreate = z.infer<typeof contactAttemptCreateSchema>;
export type ContactAttempt = z.infer<typeof contactAttemptSchema>;
export type ContactChannel = z.infer<typeof contactChannelSchema>;
export type ContactStatus = z.infer<typeof contactStatusSchema>;
