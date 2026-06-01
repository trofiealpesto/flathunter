import { z } from "zod";

export const llmAnalysisPromptVersion = "english-analyst-v2";
// Bumped to "unified-v1": classifier and analyst merged into one call; deterministic MATCH removed.
export const semanticClassificationPromptVersion = "unified-v1";

export const llmErrorKindSchema = z.enum([
  "timeout",
  "invalid_json",
  "http_error",
  "empty_response",
  "transport_error",
  "rate_limit",
  "auth_error"
]);
export const llmAnalysisStatusSchema = z.enum(["ready", "missing", "stale", "error"]);

export const llmAnalysisSchema = z.object({
  sourceLanguage: z.string().trim().min(1),
  translatedTitle: z.string().trim().min(1).nullable(),
  translatedDescription: z.string().trim().min(1).nullable(),
  summary: z.string().trim().min(1),
  fitNote: z.string().trim().min(1),
  model: z.string().trim().min(1),
  translationModel: z.string().trim().min(1).nullable(),
  promptVersion: z.string().trim().min(1),
  inputFingerprint: z.string().trim().min(1),
  updatedAt: z.string()
});

export type LlmErrorKind = z.infer<typeof llmErrorKindSchema>;
export type LlmAnalysisStatus = z.infer<typeof llmAnalysisStatusSchema>;
export type LlmAnalysis = z.infer<typeof llmAnalysisSchema>;
