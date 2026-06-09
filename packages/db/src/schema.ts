import type {
  AppSettings,
  GeoSearchResult,
  LlmAnalysis,
  LlmErrorKind,
  ListingGeoSource,
  Portal,
  SourceAuthMode,
  SourceAuthStatus,
  SourceRunMode,
  SourceRunStatus
} from "@flathunter/shared";
import {
  appSettingsSchema,
  contactChannels,
  contactStatuses,
  eligibilityStates,
  portals,
  userStatuses
} from "@flathunter/shared";
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex
} from "drizzle-orm/pg-core";

export const portalEnum = pgEnum("portal", portals);
export const userStatusEnum = pgEnum("user_status", userStatuses);
export const eligibilityStateEnum = pgEnum("eligibility_state", eligibilityStates);
export const contactChannelEnum = pgEnum("contact_channel", contactChannels);
export const contactStatusEnum = pgEnum("contact_status", contactStatuses);

export const listings = pgTable(
  "listings",
  {
    id: serial("id").primaryKey(),
    portal: portalEnum("portal").notNull(),
    portalListingId: text("portal_listing_id"),
    url: text("url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    addressLine: text("address_line"),
    city: text("city"),
    district: text("district"),
    neighborhood: text("neighborhood"),
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    geoSource: text("geo_source").$type<ListingGeoSource | null>(),
    rentCold: numeric("rent_cold", { precision: 10, scale: 2 }),
    rentWarm: numeric("rent_warm", { precision: 10, scale: 2 }),
    sizeSqm: numeric("size_sqm", { precision: 8, scale: 2 }),
    rooms: numeric("rooms", { precision: 4, scale: 1 }),
    floor: text("floor"),
    availableFrom: text("available_from"),
    isFurnished: boolean("is_furnished").notNull().default(false),
    hasBalcony: boolean("has_balcony").notNull().default(false),
    hasElevator: boolean("has_elevator").notNull().default(false),
    score: integer("score"),
    semanticFitScore: integer("semantic_fit_score"),
    commuteMinutes: integer("commute_minutes"),
    commuteSource: text("commute_source"),
    userStatus: userStatusEnum("user_status").notNull().default("NEW"),
    eligibilityState: eligibilityStateEnum("eligibility_state").notNull().default("UNSURE"),
    eligibilityReason: text("eligibility_reason"),
    analysisFlags: jsonb("analysis_flags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    semanticFlags: jsonb("semantic_flags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    semanticModel: text("semantic_model"),
    semanticInputFingerprint: text("semantic_input_fingerprint"),
    semanticUpdatedAt: timestamp("semantic_updated_at", { withTimezone: true }),
    semanticLastErrorKind: text("semantic_last_error_kind").$type<LlmErrorKind | null>(),
    semanticLastErrorAt: timestamp("semantic_last_error_at", { withTimezone: true }),
    llmAnalysis: jsonb("llm_analysis").$type<LlmAnalysis | null>(),
    llmLastErrorKind: text("llm_last_error_kind").$type<LlmErrorKind | null>(),
    llmLastErrorAt: timestamp("llm_last_error_at", { withTimezone: true }),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown> | null>(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    portalListingUnique: uniqueIndex("listings_portal_listing_idx").on(table.portal, table.portalListingId),
    canonicalUrlUnique: uniqueIndex("listings_canonical_url_idx").on(table.portal, table.canonicalUrl)
  })
);

export const contactAttempts = pgTable("contact_attempts", {
  id: serial("id").primaryKey(),
  listingId: integer("listing_id")
    .notNull()
    .references(() => listings.id, { onDelete: "cascade" }),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  channel: contactChannelEnum("channel").notNull(),
  messageSubject: text("message_subject"),
  messageBody: text("message_body"),
  status: contactStatusEnum("status").notNull(),
  errorMessage: text("error_message")
});

export const portalSources = pgTable("portal_sources", {
  id: serial("id").primaryKey(),
  portal: portalEnum("portal").notNull().unique(),
  enabled: boolean("enabled").notNull().default(true),
  searchUrl: text("search_url").notNull(),
  searchParams: jsonb("search_params").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  scrapeIntervalMinutes: integer("scrape_interval_minutes").notNull().default(30),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastError: text("last_error"),
  lastMode: text("last_mode").$type<SourceRunMode | null>(),
  lastStatus: text("last_status").$type<SourceRunStatus | null>(),
  lastListingsFound: integer("last_listings_found"),
  lastListingsUpserted: integer("last_listings_upserted"),
  lastFailedDetails: integer("last_failed_details")
});

export const portalCredentials = pgTable("portal_credentials", {
  id: serial("id").primaryKey(),
  portal: portalEnum("portal").notNull().unique(),
  authMode: text("auth_mode").$type<SourceAuthMode>().notNull(),
  loginIdentifier: text("login_identifier").notNull(),
  encryptedPayload: text("encrypted_payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const portalSessions = pgTable("portal_sessions", {
  id: serial("id").primaryKey(),
  portal: portalEnum("portal").notNull().unique(),
  encryptedStorageState: text("encrypted_storage_state"),
  status: text("status").$type<SourceAuthStatus>().notNull().default("missing_credentials"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  lastAuthenticatedAt: timestamp("last_authenticated_at", { withTimezone: true }),
  lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
  lastAuthError: text("last_auth_error"),
  lastChallengeType: text("last_challenge_type"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const appSettings = pgTable(
  "app_settings",
  {
    key: text("key").primaryKey().notNull().default("default"),
    data: jsonb("data").$type<AppSettings>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    singletonCheck: check("app_settings_singleton_chk", sql`${table.key} = 'default'`)
  })
);

export const geocodeCache = pgTable(
  "geocode_cache",
  {
    id: serial("id").primaryKey(),
    query: text("query").notNull(),
    results: jsonb("results").$type<GeoSearchResult[]>().notNull().default(sql`'[]'::jsonb`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    geocodeQueryUnique: uniqueIndex("geocode_cache_query_idx").on(table.query)
  })
);

export const commuteCache = pgTable(
  "commute_cache",
  {
    id: serial("id").primaryKey(),
    query: text("query").notNull(),
    minutes: integer("minutes"),
    source: text("source").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    commuteQueryUnique: uniqueIndex("commute_cache_query_idx").on(table.query)
  })
);

export const listingsRelations = relations(listings, ({ many }) => ({
  contactAttempts: many(contactAttempts)
}));

export const contactAttemptsRelations = relations(contactAttempts, ({ one }) => ({
  listing: one(listings, {
    fields: [contactAttempts.listingId],
    references: [listings.id]
  })
}));

export type ListingRow = typeof listings.$inferSelect;
export type ListingInsert = typeof listings.$inferInsert;
export type PortalRow = typeof portalSources.$inferSelect;
export type PortalSourceInsert = typeof portalSources.$inferInsert;
export type PortalCredentialRow = typeof portalCredentials.$inferSelect;
export type PortalCredentialInsert = typeof portalCredentials.$inferInsert;
export type PortalSessionRow = typeof portalSessions.$inferSelect;
export type PortalSessionInsert = typeof portalSessions.$inferInsert;
export type AppSettingsRow = typeof appSettings.$inferSelect;
export type GeocodeCacheRow = typeof geocodeCache.$inferSelect;
export type SupportedPortal = Portal;

export function validateSettingsRow(settings: AppSettings): AppSettings {
  return appSettingsSchema.parse(settings);
}
