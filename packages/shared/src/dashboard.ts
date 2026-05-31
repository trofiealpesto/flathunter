import { z } from "zod";

import { eligibilityStateSchema, portalSchema, userStatusSchema } from "./listings";
import { llmAnalysisStatusSchema, llmErrorKindSchema } from "./llm-analysis";
import { listingGeoSourceSchema } from "./geo";

export const dashboardTotalsSchema = z.object({
  listings: z.number().int().nonnegative(),
  reviewQueue: z.number().int().nonnegative(),
  match: z.number().int().nonnegative(),
  contacted: z.number().int().nonnegative(),
  unsure: z.number().int().nonnegative(),
  reject: z.number().int().nonnegative()
});

export const statusBreakdownItemSchema = z.object({
  status: userStatusSchema,
  count: z.number().int().nonnegative()
});

export const eligibilityBreakdownItemSchema = z.object({
  eligibility: eligibilityStateSchema,
  count: z.number().int().nonnegative()
});

export const portalBreakdownItemSchema = z.object({
  portal: portalSchema,
  count: z.number().int().nonnegative()
});

export const rentBandSchema = z.object({
  label: z.string().trim().min(1),
  min: z.number().nonnegative().nullable(),
  max: z.number().nonnegative().nullable(),
  count: z.number().int().nonnegative()
});

export const districtSummarySchema = z.object({
  district: z.string().trim().min(1),
  count: z.number().int().nonnegative(),
  averageWarmRent: z.number().nonnegative().nullable(),
  averageScore: z.number().nonnegative().nullable()
});

export const districtGeoSummarySchema = districtSummarySchema.extend({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  averageDistanceKm: z.number().nonnegative().nullable()
});

export const distanceBandSchema = z.object({
  label: z.string().trim().min(1),
  min: z.number().nonnegative().nullable(),
  max: z.number().nonnegative().nullable(),
  count: z.number().int().nonnegative()
});

export const rentSizePointSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().trim().min(1),
  portal: portalSchema,
  userStatus: userStatusSchema,
  district: z.string().nullable(),
  eligibilityState: eligibilityStateSchema,
  score: z.number().int().nullable(),
  rent: z.number().nonnegative().nullable(),
  sizeSqm: z.number().nonnegative().nullable(),
  distanceKm: z.number().nonnegative().nullable(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  geoSource: listingGeoSourceSchema.nullable(),
  llmAnalysisStatus: llmAnalysisStatusSchema
});

export const geoPrecisionSchema = z.enum(["portal_coordinates", "district_centroid", "unknown"]);

export const geoPrecisionBreakdownItemSchema = z.object({
  precision: geoPrecisionSchema,
  count: z.number().int().nonnegative()
});

export const llmErrorBreakdownItemSchema = z.object({
  kind: llmErrorKindSchema,
  count: z.number().int().nonnegative()
});

export const llmHealthSchema = z.object({
  providerConfigured: z.boolean(),
  classifierReady: z.number().int().nonnegative(),
  classifierError: z.number().int().nonnegative(),
  classifierErrorBreakdown: z.array(llmErrorBreakdownItemSchema),
  analystReady: z.number().int().nonnegative(),
  analystMissing: z.number().int().nonnegative(),
  analystStale: z.number().int().nonnegative(),
  analystError: z.number().int().nonnegative(),
  analystErrorBreakdown: z.array(llmErrorBreakdownItemSchema)
});

export const dashboardStatsSchema = z.object({
  totals: dashboardTotalsSchema,
  statusBreakdown: z.array(statusBreakdownItemSchema),
  eligibilityBreakdown: z.array(eligibilityBreakdownItemSchema),
  portalBreakdown: z.array(portalBreakdownItemSchema),
  rentBands: z.array(rentBandSchema),
  topDistricts: z.array(districtSummarySchema),
  districtGeoSummary: z.array(districtGeoSummarySchema),
  distanceBands: z.array(distanceBandSchema),
  rentSizePoints: z.array(rentSizePointSchema),
  geoPrecisionBreakdown: z.array(geoPrecisionBreakdownItemSchema),
  llmHealth: llmHealthSchema
});

export type DashboardTotals = z.infer<typeof dashboardTotalsSchema>;
export type StatusBreakdownItem = z.infer<typeof statusBreakdownItemSchema>;
export type EligibilityBreakdownItem = z.infer<typeof eligibilityBreakdownItemSchema>;
export type PortalBreakdownItem = z.infer<typeof portalBreakdownItemSchema>;
export type RentBand = z.infer<typeof rentBandSchema>;
export type DistrictSummary = z.infer<typeof districtSummarySchema>;
export type DistrictGeoSummary = z.infer<typeof districtGeoSummarySchema>;
export type DistanceBand = z.infer<typeof distanceBandSchema>;
export type RentSizePoint = z.infer<typeof rentSizePointSchema>;
export type GeoPrecision = z.infer<typeof geoPrecisionSchema>;
export type GeoPrecisionBreakdownItem = z.infer<typeof geoPrecisionBreakdownItemSchema>;
export type LlmErrorBreakdownItem = z.infer<typeof llmErrorBreakdownItemSchema>;
export type LlmHealth = z.infer<typeof llmHealthSchema>;
export type DashboardStats = z.infer<typeof dashboardStatsSchema>;
