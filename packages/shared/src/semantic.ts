import { z } from "zod";

export const semanticFlagSchema = z.enum([
  "LONG_TERM",
  "SHORT_TERM",
  "WBS_REQUIRED",
  "COUPLE_FRIENDLY",
  "FURNISHED",
  "NO_REGISTRATION",
  "PET_FRIENDLY"
]);

export const semanticClassificationSchema = z.object({
  eligibilityState: z.enum(["MATCH", "UNSURE", "REJECT"]),
  reason: z.string().trim().min(1),
  flags: z.array(semanticFlagSchema).default([]),
  fitScore: z.number().int().min(0).max(100).optional()
});

export type SemanticClassification = z.infer<typeof semanticClassificationSchema>;

export const translationResultSchema = z.object({
  sourceLanguage: z.string().trim().min(1),
  translatedTitle: z.string().trim().min(1).nullable(),
  translatedDescription: z.string().trim().min(1).nullable()
});

export type TranslationResult = z.infer<typeof translationResultSchema>;

export const englishListingAnalystSchema = translationResultSchema.extend({
  eligibilityState: z.enum(["MATCH", "UNSURE", "REJECT"]),
  reason: z.string().trim().min(1),
  flags: z.array(semanticFlagSchema).default([]),
  summary: z.string().trim().min(1),
  fitNote: z.string().trim().min(1)
});

export type EnglishListingAnalyst = z.infer<typeof englishListingAnalystSchema>;

// Unified evaluation schema: single Gemini call produces classification + translation + analysis + fit score.
export const unifiedEvaluationSchema = englishListingAnalystSchema.extend({
  fitScore: z.number().int().min(0).max(100).optional()
});

export type UnifiedEvaluation = z.infer<typeof unifiedEvaluationSchema>;

export const semanticClassificationJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    eligibilityState: {
      type: "string",
      enum: ["MATCH", "UNSURE", "REJECT"]
    },
    reason: {
      type: "string"
    },
    flags: {
      type: "array",
      items: {
        type: "string",
        enum: ["LONG_TERM", "SHORT_TERM", "WBS_REQUIRED", "COUPLE_FRIENDLY", "FURNISHED", "NO_REGISTRATION", "PET_FRIENDLY"]
      }
    },
    fitScore: {
      type: "integer",
      minimum: 0,
      maximum: 100
    }
  },
  required: ["eligibilityState", "reason", "flags", "fitScore"]
} as const;

export const translationResultJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sourceLanguage: {
      type: "string"
    },
    translatedTitle: {
      type: ["string", "null"]
    },
    translatedDescription: {
      type: ["string", "null"]
    }
  },
  required: ["sourceLanguage", "translatedTitle", "translatedDescription"]
} as const;

export const englishListingAnalystJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sourceLanguage: {
      type: "string"
    },
    translatedTitle: {
      type: ["string", "null"]
    },
    translatedDescription: {
      type: ["string", "null"]
    },
    eligibilityState: {
      type: "string",
      enum: ["MATCH", "UNSURE", "REJECT"]
    },
    reason: {
      type: "string"
    },
    flags: {
      type: "array",
      items: {
        type: "string",
        enum: ["LONG_TERM", "SHORT_TERM", "WBS_REQUIRED", "COUPLE_FRIENDLY", "FURNISHED", "NO_REGISTRATION", "PET_FRIENDLY"]
      }
    },
    summary: {
      type: "string"
    },
    fitNote: {
      type: "string"
    }
  },
  required: [
    "sourceLanguage",
    "translatedTitle",
    "translatedDescription",
    "eligibilityState",
    "reason",
    "flags",
    "summary",
    "fitNote"
  ]
} as const;

// JSON schema for the unified evaluation (classification + translation + analysis + fitScore).
export const unifiedEvaluationJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sourceLanguage: { type: "string" },
    translatedTitle: { type: ["string", "null"] },
    translatedDescription: { type: ["string", "null"] },
    eligibilityState: { type: "string", enum: ["MATCH", "UNSURE", "REJECT"] },
    reason: { type: "string" },
    flags: {
      type: "array",
      items: {
        type: "string",
        enum: ["LONG_TERM", "SHORT_TERM", "WBS_REQUIRED", "COUPLE_FRIENDLY", "FURNISHED", "NO_REGISTRATION", "PET_FRIENDLY"]
      }
    },
    fitScore: { type: "integer", minimum: 0, maximum: 100 },
    summary: { type: "string" },
    fitNote: { type: "string" }
  },
  required: [
    "sourceLanguage",
    "translatedTitle",
    "translatedDescription",
    "eligibilityState",
    "reason",
    "flags",
    "fitScore",
    "summary",
    "fitNote"
  ]
} as const;
