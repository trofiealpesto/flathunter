import { z } from "zod";

import { portalSchema } from "./listings";

export const sourceRunModeSchema = z.enum(["fixture", "live"]);
export const sourceRunStatusSchema = z.enum(["success", "partial", "failed"]);
export const sourceAuthStatusSchema = z.enum([
  "missing_credentials",
  "ready",
  "session_valid",
  "session_expired",
  "auth_failed",
  "challenge_required"
]);
export const sourceAuthBootstrapStatusSchema = z.enum(["idle", "running"]);
export const sourceAuthModeSchema = z.enum(["FORM_CREDENTIALS"]);
export const portalSearchParamsSchema = z.record(z.string(), z.unknown());
export const portalSourceKindSchema = z.enum(["scraping", "public_api"]);
export const portalSourceCapabilitiesSchema = z.object({
  supportsLogin: z.boolean(),
  supportsCaptchaSolver: z.boolean(),
  supportsDetailFallback: z.boolean(),
  sourceKind: portalSourceKindSchema,
  readiness: z.enum(["primary", "secondary", "experimental"]),
  cloudCompatible: z.boolean(),
  requiresAuthSetup: z.boolean(),
  setupHint: z.string()
});

export const portalSourceSummarySchema = z.object({
  id: z.number().int().positive(),
  portal: portalSchema,
  enabled: z.boolean(),
  searchUrl: z.string().url(),
  searchParams: portalSearchParamsSchema,
  scrapeIntervalMinutes: z.number().int().positive(),
  lastRunAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  lastError: z.string().nullable(),
  lastMode: sourceRunModeSchema.nullable(),
  lastStatus: sourceRunStatusSchema.nullable(),
  lastListingsFound: z.number().int().nonnegative().nullable(),
  lastListingsUpserted: z.number().int().nonnegative().nullable(),
  lastFailedDetails: z.number().int().nonnegative().nullable(),
  authStatus: sourceAuthStatusSchema,
  hasCredentials: z.boolean(),
  lastAuthAt: z.string().nullable(),
  lastAuthError: z.string().nullable(),
  lastChallengeType: z.string().nullable(),
  capabilities: portalSourceCapabilitiesSchema
});

export const portalSourcePatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    searchUrl: z.string().url().optional(),
    searchParams: portalSearchParamsSchema.optional(),
    scrapeIntervalMinutes: z.number().int().positive().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one source field must be provided"
  });

export const portalSourceAuthSummarySchema = z.object({
  portal: portalSchema,
  authMode: sourceAuthModeSchema.nullable(),
  loginIdentifier: z.string().nullable(),
  authStatus: sourceAuthStatusSchema,
  hasCredentials: z.boolean(),
  lastAuthAt: z.string().nullable(),
  lastValidatedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  lastAuthError: z.string().nullable(),
  lastChallengeType: z.string().nullable(),
  capabilities: portalSourceCapabilitiesSchema
});

export const portalSourceAuthBootstrapSummarySchema = z.object({
  portal: portalSchema,
  status: sourceAuthBootstrapStatusSchema,
  loginUrl: z.string().nullable(),
  message: z.string().nullable(),
  startedAt: z.string().nullable(),
  updatedAt: z.string().nullable()
});

export const portalSourceAuthBootstrapFinishSchema = z.object({
  bootstrap: portalSourceAuthBootstrapSummarySchema,
  authSummary: portalSourceAuthSummarySchema
});

export const portalSourceAuthUpsertSchema = z.object({
  authMode: sourceAuthModeSchema.default("FORM_CREDENTIALS"),
  loginIdentifier: z.string().trim().min(1),
  password: z.string().min(1)
});

export type PortalSourceSummary = z.infer<typeof portalSourceSummarySchema>;
export type PortalSourcePatch = z.infer<typeof portalSourcePatchSchema>;
export type SourceRunMode = z.infer<typeof sourceRunModeSchema>;
export type SourceRunStatus = z.infer<typeof sourceRunStatusSchema>;
export type SourceAuthStatus = z.infer<typeof sourceAuthStatusSchema>;
export type SourceAuthBootstrapStatus = z.infer<typeof sourceAuthBootstrapStatusSchema>;
export type SourceAuthMode = z.infer<typeof sourceAuthModeSchema>;
export type PortalSearchParams = z.infer<typeof portalSearchParamsSchema>;
export type PortalSourceKind = z.infer<typeof portalSourceKindSchema>;
export type PortalSourceCapabilities = z.infer<typeof portalSourceCapabilitiesSchema>;
export type PortalSourceAuthSummary = z.infer<typeof portalSourceAuthSummarySchema>;
export type PortalSourceAuthBootstrapSummary = z.infer<typeof portalSourceAuthBootstrapSummarySchema>;
export type PortalSourceAuthBootstrapFinishResult = z.infer<typeof portalSourceAuthBootstrapFinishSchema>;
export type PortalSourceAuthUpsert = z.infer<typeof portalSourceAuthUpsertSchema>;
