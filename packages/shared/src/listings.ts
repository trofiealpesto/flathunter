import { z } from "zod";

import { listingGeoSourceSchema } from "./geo";
import { llmAnalysisSchema, llmAnalysisStatusSchema } from "./llm-analysis";

export const portals = ["IMMOWELT", "IMMOSCOUT24", "KLEINANZEIGEN", "WG_GESUCHT", "FLATSFORFRIENDZ", "INBERLINWOHNEN"] as const;
export const userStatuses = ["NEW", "REVIEWED", "CONTACTED", "REJECTED", "BLACKLISTED"] as const;
export const eligibilityStates = ["MATCH", "UNSURE", "REJECT"] as const;
export const contactChannels = ["PORTAL_FORM", "EMAIL", "PHONE", "OTHER"] as const;
export const contactStatuses = ["SENT", "FAILED", "MANUAL"] as const;
export const listingSourceModes = ["fixture", "live"] as const;
export const analysisFlags = [
  "wbs_required",
  "swap_only",
  "temporary_sublet",
  "room_only",
  "couple_friendly",
  "long_term",
  "balcony_mentioned",
  "elevator_mentioned",
  "furnished_text"
] as const;

export const portalSchema = z.enum(portals);
export const userStatusSchema = z.enum(userStatuses);
export const eligibilityStateSchema = z.enum(eligibilityStates);
export const contactChannelSchema = z.enum(contactChannels);
export const contactStatusSchema = z.enum(contactStatuses);
export const listingSourceModeSchema = z.enum(listingSourceModes);
export const analysisFlagSchema = z.enum(analysisFlags);

export const listingSortValues = ["best", "newest"] as const;
export const listingSortSchema = z.enum(listingSortValues);

export const listingFilterSchema = z.object({
  portal: portalSchema.optional(),
  userStatus: userStatusSchema.optional(),
  eligibilityState: eligibilityStateSchema.optional(),
  maxRentWarm: z.coerce.number().optional(),
  minSizeSqm: z.coerce.number().optional(),
  minScore: z.coerce.number().optional(),
  district: z.string().trim().min(1).optional(),
  query: z.string().trim().min(1).optional(),
  sort: listingSortSchema.optional(),
  includeDuplicates: z.coerce.boolean().optional()
});

export const listingBaseSchema = z.object({
  id: z.number().int(),
  portal: portalSchema,
  portalListingId: z.string().nullable(),
  url: z.string().url(),
  canonicalUrl: z.string().url(),
  title: z.string(),
  description: z.string().nullable(),
  addressLine: z.string().nullable(),
  city: z.string().nullable(),
  district: z.string().nullable(),
  neighborhood: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  geoSource: listingGeoSourceSchema.nullable(),
  distanceKm: z.number().nullable(),
  rentCold: z.number().nullable(),
  rentWarm: z.number().nullable(),
  sizeSqm: z.number().nullable(),
  rooms: z.number().nullable(),
  floor: z.string().nullable(),
  availableFrom: z.string().nullable(),
  isFurnished: z.boolean(),
  hasBalcony: z.boolean(),
  hasElevator: z.boolean(),
  score: z.number().int().nullable(),
  semanticFitScore: z.number().int().nullish(),
  commuteMinutes: z.number().int().nullable(),
  commuteSource: z.string().nullable(),
  duplicateOfListingId: z.number().int().nullable(),
  userStatus: userStatusSchema,
  eligibilityState: eligibilityStateSchema,
  eligibilityReason: z.string().nullable(),
  sourceMode: listingSourceModeSchema.nullable(),
  analysisFlags: z.array(analysisFlagSchema),
  semanticFlags: z.array(z.string()),
  semanticModel: z.string().nullable(),
  llmAnalysis: llmAnalysisSchema.nullable(),
  llmAnalysisStatus: llmAnalysisStatusSchema,
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const listingSummarySchema = listingBaseSchema;

export const listingDetailSchema = listingBaseSchema.extend({
  rawPayload: z.record(z.string(), z.unknown()).nullable()
});

export const listingStatusUpdateSchema = z.object({
  userStatus: userStatusSchema
});

export const listingUpsertInputSchema = z.object({
  portal: portalSchema,
  portalListingId: z.string().trim().min(1).nullable(),
  url: z.string().url(),
  canonicalUrl: z.string().url(),
  title: z.string().trim().min(1),
  description: z.string().nullable(),
  addressLine: z.string().nullable(),
  city: z.string().nullable(),
  district: z.string().nullable(),
  neighborhood: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  geoSource: listingGeoSourceSchema.nullable().optional(),
  rentCold: z.number().nullable(),
  rentWarm: z.number().nullable(),
  sizeSqm: z.number().nullable(),
  rooms: z.number().nullable(),
  floor: z.string().nullable(),
  availableFrom: z.string().nullable(),
  isFurnished: z.boolean().default(false),
  hasBalcony: z.boolean().default(false),
  hasElevator: z.boolean().default(false),
  rawPayload: z.record(z.string(), z.unknown()).nullable()
});

export type Portal = z.infer<typeof portalSchema>;
export type UserStatus = z.infer<typeof userStatusSchema>;
export type EligibilityState = z.infer<typeof eligibilityStateSchema>;
export type ListingSourceMode = z.infer<typeof listingSourceModeSchema>;
export type AnalysisFlag = z.infer<typeof analysisFlagSchema>;
export type ListingSort = z.infer<typeof listingSortSchema>;
export type ListingFilters = z.infer<typeof listingFilterSchema>;
export type ListingSummary = z.infer<typeof listingSummarySchema>;
export type ListingDetail = z.infer<typeof listingDetailSchema>;
export type ListingStatusUpdate = z.infer<typeof listingStatusUpdateSchema>;
export type ListingUpsertInput = z.infer<typeof listingUpsertInputSchema>;
