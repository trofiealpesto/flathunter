import type {
  AnalysisFlag,
  AppSettings,
  AppSettingsPatch,
  EligibilityState,
  GeoSearchResult,
  LlmAnalysis,
  LlmAnalysisStatus,
  LlmErrorKind,
  ListingFilters,
  ListingGeoSource,
  ListingSourceMode,
  ListingUpsertInput,
  OfficeLocation,
  Portal,
  PortalSourceAuthSummary,
  PortalSourceAuthUpsert,
  PortalSourceCapabilities,
  PortalSourcePatch,
  PortalSourceSummary,
  SourceAuthStatus,
  SourceRunMode,
  SourceRunStatus,
  UserStatus
} from "@flathunter/shared";
import {
  analysisFlags,
  appSettingsPatchSchema,
  appSettingsSchema,
  buildEnglishAnalystFingerprint,
  defaultAppSettings,
  eligibilityStates,
  getBerlinDistrictCentroid,
  haversineDistanceKm,
  llmAnalysisSchema,
  llmErrorKindSchema,
  portalSourceAuthUpsertSchema,
  portalSourcePatchSchema,
  portals,
  userStatuses
} from "@flathunter/shared";
import { and, desc, eq, ilike, inArray, sql } from "drizzle-orm";

import type { Database } from "./client";
import { decryptJson, encryptJson } from "./secrets";
import {
  appSettings,
  geocodeCache,
  listings,
  portalCredentials,
  portalSessions,
  portalSources
} from "./schema";

type ListingRow = typeof listings.$inferSelect;
type PortalSourceRow = typeof portalSources.$inferSelect;
type PortalCredentialRow = typeof portalCredentials.$inferSelect;
type PortalSessionRow = typeof portalSessions.$inferSelect;

const rentBandDefinitions = [
  { label: "Under 1200", min: null, max: 1200 },
  { label: "1200-1500", min: 1200, max: 1500 },
  { label: "1500-1800", min: 1500, max: 1800 },
  { label: "1800-2200", min: 1800, max: 2200 },
  { label: "2200+", min: 2200, max: null }
] as const;

const distanceBandDefinitions = [
  { label: "0-3km", min: 0, max: 3 },
  { label: "3-6km", min: 3, max: 6 },
  { label: "6-9km", min: 6, max: 9 },
  { label: "9km+", min: 9, max: null }
] as const;

const portalCapabilities: Record<Portal, PortalSourceCapabilities> = {
  IMMOWELT: {
    supportsLogin: true,
    supportsCaptchaSolver: true,
    supportsDetailFallback: true,
    sourceKind: "scraping",
    readiness: "primary",
    cloudCompatible: true,
    requiresAuthSetup: false,
    setupHint: "Primary scraping source. No developer API or partner account is required."
  },
  FLATSFORFRIENDZ: {
    supportsLogin: false,
    supportsCaptchaSolver: false,
    supportsDetailFallback: false,
    sourceKind: "public_api",
    readiness: "experimental",
    cloudCompatible: true,
    requiresAuthSetup: false,
    setupHint: "Experimental public offers feed. No account setup is required for the current offers-only integration."
  },
  IMMOSCOUT24: {
    supportsLogin: true,
    supportsCaptchaSolver: true,
    supportsDetailFallback: true,
    sourceKind: "scraping",
    readiness: "experimental",
    cloudCompatible: false,
    requiresAuthSetup: true,
    setupHint: "Experimental scraping source. Use a normal portal account and refresh the browser session before enabling it."
  },
  WG_GESUCHT: {
    supportsLogin: true,
    supportsCaptchaSolver: true,
    supportsDetailFallback: true,
    sourceKind: "scraping",
    readiness: "secondary",
    cloudCompatible: false,
    requiresAuthSetup: true,
    setupHint: "Secondary scraping source. Use a normal portal account; no developer API access is expected."
  },
  KLEINANZEIGEN: {
    supportsLogin: true,
    supportsCaptchaSolver: true,
    supportsDetailFallback: true,
    sourceKind: "scraping",
    readiness: "experimental",
    cloudCompatible: false,
    requiresAuthSetup: true,
    setupHint: "Experimental scraping source. Keep it disabled until authentication and reliability are proven on your session."
  }
};

function toNullableNumber(value: string | number | null): number | null {
  if (value == null) {
    return null;
  }

  return Number(value);
}

function resolveSourceAuthStatus(
  credentialRow: PortalCredentialRow | null | undefined,
  sessionRow: PortalSessionRow | null | undefined
): SourceAuthStatus {
  if (!credentialRow) {
    if (sessionRow?.status === "session_valid") {
      if (sessionRow.expiresAt && sessionRow.expiresAt.getTime() < Date.now()) {
        return "session_expired";
      }

      return "session_valid";
    }

    return "missing_credentials";
  }

  if (sessionRow) {
    if (sessionRow.status === "session_valid" && sessionRow.expiresAt && sessionRow.expiresAt.getTime() < Date.now()) {
      return "session_expired";
    }

    return sessionRow.status;
  }

  if (!credentialRow) {
    return "missing_credentials";
  }

  return "ready";
}

function serializePortalSourceAuthSummary(
  portal: Portal,
  credentialRow?: PortalCredentialRow | null,
  sessionRow?: PortalSessionRow | null
): PortalSourceAuthSummary {
  const capabilities = portalCapabilities[portal];
  const authStatus = capabilities.supportsLogin
    ? resolveSourceAuthStatus(credentialRow, sessionRow)
    : sessionRow?.status === "session_valid"
      ? "session_valid"
      : "ready";

  return {
    portal,
    authMode: credentialRow?.authMode ?? null,
    loginIdentifier: credentialRow?.loginIdentifier ?? null,
    authStatus,
    hasCredentials: Boolean(credentialRow),
    lastAuthAt: sessionRow?.lastAuthenticatedAt?.toISOString() ?? null,
    lastValidatedAt: sessionRow?.lastValidatedAt?.toISOString() ?? null,
    expiresAt: sessionRow?.expiresAt?.toISOString() ?? null,
    lastAuthError: sessionRow?.lastAuthError ?? null,
    lastChallengeType: sessionRow?.lastChallengeType ?? null,
    capabilities
  };
}

function serializePortalSource(
  row: PortalSourceRow,
  credentialRow?: PortalCredentialRow | null,
  sessionRow?: PortalSessionRow | null
): PortalSourceSummary {
  const authSummary = serializePortalSourceAuthSummary(row.portal, credentialRow, sessionRow);
  const normalizedLastError =
    row.lastError?.trim().startsWith('Failed query: insert into "listings"')
      ? "The last run failed while saving listings to the database."
      : row.lastError?.trim().startsWith("Failed query:")
        ? "The last run failed in the database layer."
        : row.lastError;
  const isLegacyImmoweltBlockedDetailFallback =
    row.portal === "IMMOWELT" &&
    row.lastStatus === "partial" &&
    row.lastMode === "live" &&
    (row.lastFailedDetails ?? 0) > 0 &&
    Boolean(normalizedLastError) &&
    normalizedLastError?.includes("blocked detail pages") &&
    !normalizedLastError.includes("invalid or non-listing detail pages") &&
    !normalizedLastError.includes("detail fetch errors");

  return {
    id: row.id,
    portal: row.portal,
    enabled: row.enabled,
    searchUrl: row.searchUrl,
    searchParams: row.searchParams ?? {},
    scrapeIntervalMinutes: row.scrapeIntervalMinutes,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    lastError: isLegacyImmoweltBlockedDetailFallback ? null : normalizedLastError ?? null,
    lastMode: row.lastMode ?? null,
    lastStatus: isLegacyImmoweltBlockedDetailFallback ? "success" : row.lastStatus ?? null,
    lastListingsFound: row.lastListingsFound ?? null,
    lastListingsUpserted: row.lastListingsUpserted ?? null,
    lastFailedDetails: isLegacyImmoweltBlockedDetailFallback ? 0 : row.lastFailedDetails ?? null,
    authStatus: authSummary.authStatus,
    hasCredentials: authSummary.hasCredentials,
    lastAuthAt: authSummary.lastAuthAt,
    lastAuthError: authSummary.lastAuthError,
    lastChallengeType: authSummary.lastChallengeType,
    capabilities: authSummary.capabilities
  };
}

function parseAnalysisFlags(value: unknown): AnalysisFlag[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is AnalysisFlag => analysisFlags.includes(item as AnalysisFlag));
}

function parseSourceMode(rawPayload: unknown): ListingSourceMode | null {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return null;
  }

  const source = (rawPayload as Record<string, unknown>).source;
  return source === "fixture" || source === "live" ? source : null;
}

function parseGeoSource(value: unknown): ListingGeoSource | null {
  return value === "portal_coordinates" || value === "district_centroid" ? value : null;
}

function parseLlmAnalysis(value: unknown): LlmAnalysis | null {
  const parsed = llmAnalysisSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseLlmErrorKind(value: unknown): LlmErrorKind | null {
  const parsed = llmErrorKindSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function buildLlmErrorBreakdown(values: unknown[]) {
  const counts = new Map<LlmErrorKind, number>();

  for (const value of values) {
    const kind = parseLlmErrorKind(value);

    if (!kind) {
      continue;
    }

    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((left, right) => right.count - left.count);
}

function buildModelBreakdown(rows: Array<{ semanticInputFingerprint: string | null; semanticModel: string | null }>) {
  const counts = new Map<string, number>();

  for (const row of rows) {
    if (!row.semanticInputFingerprint || !row.semanticModel) {
      continue;
    }

    counts.set(row.semanticModel, (counts.get(row.semanticModel) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([model, count]) => ({ model, count }))
    .sort((left, right) => right.count - left.count);
}

function getOfficeLocation(settings: AppSettings): OfficeLocation | null {
  return settings.search.officeLocation ?? null;
}

function resolvePersistedGeo(input: Pick<ListingUpsertInput, "district" | "latitude" | "longitude" | "geoSource">) {
  if (input.latitude != null && input.longitude != null) {
    return {
      latitude: input.latitude,
      longitude: input.longitude,
      geoSource: input.geoSource ?? "portal_coordinates"
    } as const;
  }

  const centroid = getBerlinDistrictCentroid(input.district);

  if (centroid) {
    return {
      latitude: centroid.latitude,
      longitude: centroid.longitude,
      geoSource: "district_centroid" as const
    };
  }

  return {
    latitude: null,
    longitude: null,
    geoSource: null
  } as const;
}

function resolveSerializedGeo(
  row: Pick<ListingRow, "district" | "latitude" | "longitude" | "geoSource">,
  officeLocation: OfficeLocation | null
) {
  const storedLatitude = toNullableNumber(row.latitude);
  const storedLongitude = toNullableNumber(row.longitude);
  const centroid = storedLatitude == null || storedLongitude == null ? getBerlinDistrictCentroid(row.district) : null;

  const latitude = storedLatitude ?? centroid?.latitude ?? null;
  const longitude = storedLongitude ?? centroid?.longitude ?? null;
  const geoSource = parseGeoSource(row.geoSource) ?? (centroid ? "district_centroid" : null);
  const distanceKm =
    officeLocation && latitude != null && longitude != null
      ? haversineDistanceKm(officeLocation, {
          latitude,
          longitude
        })
      : null;

  return {
    latitude,
    longitude,
    geoSource,
    distanceKm
  };
}

function deriveLlmAnalysisStatus(
  row: Pick<ListingRow, "llmAnalysis" | "llmLastErrorKind">,
  listing: ReturnType<typeof serializeListingBase>,
  settings?: AppSettings | null
): LlmAnalysisStatus {
  const llmAnalysis = parseLlmAnalysis(row.llmAnalysis);
  const llmLastErrorKind = parseLlmErrorKind(row.llmLastErrorKind);

  if (settings && llmAnalysis) {
    const analystFingerprint = buildEnglishAnalystFingerprint(listing, settings);

    if (llmAnalysis.inputFingerprint === analystFingerprint) {
      return "ready";
    }
  } else if (llmAnalysis) {
    return "ready";
  }

  if (llmLastErrorKind) {
    if (llmLastErrorKind === "timeout" && !llmAnalysis) {
      return "missing";
    }

    return "error";
  }

  if (llmAnalysis) {
    return "stale";
  }

  return "missing";
}

async function getPortalCredentialRow(db: Database, portal: Portal) {
  return db.query.portalCredentials.findFirst({
    where: eq(portalCredentials.portal, portal)
  });
}

async function getPortalSessionRow(db: Database, portal: Portal) {
  return db.query.portalSessions.findFirst({
    where: eq(portalSessions.portal, portal)
  });
}

function serializeListingBase(row: ListingRow, officeLocation: OfficeLocation | null = null) {
  const geo = resolveSerializedGeo(row, officeLocation);
  const llmAnalysis = parseLlmAnalysis(row.llmAnalysis);

  return {
    id: row.id,
    portal: row.portal,
    portalListingId: row.portalListingId,
    url: row.url,
    canonicalUrl: row.canonicalUrl,
    title: row.title,
    description: row.description,
    addressLine: row.addressLine,
    city: row.city,
    district: row.district,
    neighborhood: row.neighborhood,
    latitude: geo.latitude,
    longitude: geo.longitude,
    geoSource: geo.geoSource,
    distanceKm: geo.distanceKm,
    rentCold: toNullableNumber(row.rentCold),
    rentWarm: toNullableNumber(row.rentWarm),
    sizeSqm: toNullableNumber(row.sizeSqm),
    rooms: toNullableNumber(row.rooms),
    floor: row.floor,
    availableFrom: row.availableFrom,
    isFurnished: row.isFurnished,
    hasBalcony: row.hasBalcony,
    hasElevator: row.hasElevator,
    score: row.score,
    userStatus: row.userStatus,
    eligibilityState: row.eligibilityState,
    eligibilityReason: row.eligibilityReason,
    sourceMode: parseSourceMode(row.rawPayload),
    analysisFlags: parseAnalysisFlags(row.analysisFlags),
    semanticFlags: row.semanticFlags,
    semanticModel: row.semanticModel,
    llmAnalysis,
    rawPayload: row.rawPayload,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export function serializeListing(
  row: ListingRow,
  officeLocation: OfficeLocation | null = null,
  settings?: AppSettings | null
) {
  const base = serializeListingBase(row, officeLocation);

  return {
    ...base,
    llmAnalysisStatus: deriveLlmAnalysisStatus(row, base, settings)
  };
}

export async function upsertListing(db: Database, input: ListingUpsertInput) {
  const now = new Date();
  const geo = resolvePersistedGeo(input);
  const values = {
    portal: input.portal,
    portalListingId: input.portalListingId,
    url: input.url,
    canonicalUrl: input.canonicalUrl,
    title: input.title,
    description: input.description,
    addressLine: input.addressLine,
    city: input.city,
    district: input.district,
    neighborhood: input.neighborhood,
    latitude: geo.latitude?.toFixed(6) ?? null,
    longitude: geo.longitude?.toFixed(6) ?? null,
    geoSource: geo.geoSource,
    rentCold: input.rentCold?.toFixed(2),
    rentWarm: input.rentWarm?.toFixed(2),
    sizeSqm: input.sizeSqm?.toFixed(2),
    rooms: input.rooms?.toFixed(1),
    floor: input.floor,
    availableFrom: input.availableFrom,
    isFurnished: input.isFurnished,
    hasBalcony: input.hasBalcony,
    hasElevator: input.hasElevator,
    rawPayload: input.rawPayload,
    lastSeenAt: now,
    updatedAt: now
  } as const;

  const [row] = input.portalListingId
    ? await db
        .insert(listings)
        .values({
          ...values,
          firstSeenAt: now
        })
        .onConflictDoUpdate({
          target: [listings.portal, listings.portalListingId],
          set: values
        })
        .returning()
    : await db
        .insert(listings)
        .values({
          ...values,
          firstSeenAt: now
        })
        .onConflictDoUpdate({
          target: [listings.portal, listings.canonicalUrl],
          set: values
        })
        .returning();

  return serializeListing(row);
}

export async function deleteFixtureListings(db: Database, portal: Portal) {
  const rows = await db
    .select({
      id: listings.id
    })
    .from(listings)
    .where(
      and(
        eq(listings.portal, portal),
        sql`(
          COALESCE(${listings.rawPayload}->>'source', '') = 'fixture'
          OR COALESCE(${listings.portalListingId}, '') ILIKE 'iw-berlin-%'
          OR ${listings.url} ILIKE '%/expose/iw-berlin-%'
          OR ${listings.canonicalUrl} ILIKE '%/expose/iw-berlin-%'
        )`
      )
    );

  if (rows.length === 0) {
    return 0;
  }

  await db.delete(listings).where(
    inArray(
      listings.id,
      rows.map((row) => row.id)
    )
  );

  return rows.length;
}

export async function deleteInvalidLiveListings(db: Database, portal: Portal) {
  const rows = await db
    .select({
      id: listings.id
    })
    .from(listings)
    .where(
      and(
        eq(listings.portal, portal),
        sql`(
          COALESCE(${listings.rawPayload}->>'source', '') = 'live'
          AND ${listings.canonicalUrl} NOT ILIKE 'https://www.immowelt.de/expose/%'
        )`
      )
    );

  if (rows.length === 0) {
    return 0;
  }

  await db.delete(listings).where(
    inArray(
      listings.id,
      rows.map((row) => row.id)
    )
  );

  return rows.length;
}

export async function deleteListingsBySourceMode(db: Database, portal: Portal, sourceMode: ListingSourceMode) {
  const rows = await db
    .select({
      id: listings.id
    })
    .from(listings)
    .where(and(eq(listings.portal, portal), sql`COALESCE(${listings.rawPayload}->>'source', '') = ${sourceMode}`));

  if (rows.length === 0) {
    return 0;
  }

  await db.delete(listings).where(
    inArray(
      listings.id,
      rows.map((row) => row.id)
    )
  );

  return rows.length;
}

export async function deleteInvalidLiveListingsByCanonicalPrefix(db: Database, portal: Portal, canonicalPrefix: string) {
  const rows = await db
    .select({
      id: listings.id
    })
    .from(listings)
    .where(
      and(
        eq(listings.portal, portal),
        sql`COALESCE(${listings.rawPayload}->>'source', '') = 'live' AND ${listings.canonicalUrl} NOT ILIKE ${`${canonicalPrefix}%`}`
      )
    );

  if (rows.length === 0) {
    return 0;
  }

  await db.delete(listings).where(
    inArray(
      listings.id,
      rows.map((row) => row.id)
    )
  );

  return rows.length;
}

export async function listListings(db: Database, filters: ListingFilters) {
  const conditions = [];

  if (filters.portal) {
    conditions.push(eq(listings.portal, filters.portal));
  }

  if (filters.userStatus) {
    conditions.push(eq(listings.userStatus, filters.userStatus));
  }

  if (filters.eligibilityState) {
    conditions.push(eq(listings.eligibilityState, filters.eligibilityState));
  }

  if (filters.maxRentWarm != null) {
    conditions.push(sql`COALESCE(${listings.rentWarm}, ${listings.rentCold}) <= ${filters.maxRentWarm}`);
  }

  if (filters.minSizeSqm != null) {
    conditions.push(sql`${listings.sizeSqm} >= ${filters.minSizeSqm}`);
  }

  if (filters.minScore != null) {
    conditions.push(sql`${listings.score} >= ${filters.minScore}`);
  }

  if (filters.district) {
    conditions.push(ilike(listings.district, `%${filters.district}%`));
  }

  if (filters.query) {
    conditions.push(
      sql`(${listings.title} ILIKE ${`%${filters.query}%`} OR ${listings.description} ILIKE ${`%${filters.query}%`})`
    );
  }

  const rows = await db
    .select()
    .from(listings)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(listings.lastSeenAt));

  const settings = await getSettings(db);
  const officeLocation = getOfficeLocation(settings);
  return rows.map((row) => serializeListing(row, officeLocation, settings));
}

export async function getListingById(db: Database, id: number) {
  const row = await db.query.listings.findFirst({
    where: eq(listings.id, id)
  });

  if (!row) {
    return null;
  }

  const settings = await getSettings(db);
  return serializeListing(row, getOfficeLocation(settings), settings);
}

export async function updateListingStatus(db: Database, id: number, userStatus: UserStatus) {
  const [row] = await db
    .update(listings)
    .set({
      userStatus,
      updatedAt: new Date()
    })
    .where(eq(listings.id, id))
    .returning();

  if (!row) {
    return null;
  }

  const settings = await getSettings(db);
  return serializeListing(row, getOfficeLocation(settings), settings);
}

export async function updateListingEvaluation(
  db: Database,
  id: number,
  payload: {
    score: number;
    eligibilityState: EligibilityState;
    eligibilityReason: string;
    analysisFlags: AnalysisFlag[];
    semanticFlags: string[];
    semanticModel: string | null;
    semanticInputFingerprint?: string | null;
    semanticUpdatedAt?: Date | null;
    semanticLastErrorKind?: LlmErrorKind | null;
    semanticLastErrorAt?: Date | null;
    llmLastErrorKind?: LlmErrorKind | null;
    llmLastErrorAt?: Date | null;
    llmAnalysis?: LlmAnalysis | null;
  }
) {
  const [row] = await db
    .update(listings)
    .set({
      score: payload.score,
      eligibilityState: payload.eligibilityState,
      eligibilityReason: payload.eligibilityReason,
      analysisFlags: payload.analysisFlags,
      semanticFlags: payload.semanticFlags,
      semanticModel: payload.semanticModel,
      ...(payload.semanticInputFingerprint !== undefined
        ? { semanticInputFingerprint: payload.semanticInputFingerprint }
        : {}),
      ...(payload.semanticUpdatedAt !== undefined ? { semanticUpdatedAt: payload.semanticUpdatedAt } : {}),
      ...(payload.semanticLastErrorKind !== undefined ? { semanticLastErrorKind: payload.semanticLastErrorKind } : {}),
      ...(payload.semanticLastErrorAt !== undefined ? { semanticLastErrorAt: payload.semanticLastErrorAt } : {}),
      ...(payload.llmLastErrorKind !== undefined ? { llmLastErrorKind: payload.llmLastErrorKind } : {}),
      ...(payload.llmLastErrorAt !== undefined ? { llmLastErrorAt: payload.llmLastErrorAt } : {}),
      ...(payload.llmAnalysis !== undefined ? { llmAnalysis: payload.llmAnalysis } : {}),
      updatedAt: new Date()
    })
    .where(eq(listings.id, id))
    .returning();

  return row ? serializeListing(row) : null;
}

export async function updateListingLlmState(
  db: Database,
  id: number,
  payload: {
    llmAnalysis?: LlmAnalysis | null;
    llmLastErrorKind?: LlmErrorKind | null;
    llmLastErrorAt?: Date | null;
  }
) {
  const [row] = await db
    .update(listings)
    .set({
      ...(payload.llmAnalysis !== undefined ? { llmAnalysis: payload.llmAnalysis } : {}),
      ...(payload.llmLastErrorKind !== undefined ? { llmLastErrorKind: payload.llmLastErrorKind } : {}),
      ...(payload.llmLastErrorAt !== undefined ? { llmLastErrorAt: payload.llmLastErrorAt } : {}),
      updatedAt: new Date()
    })
    .where(eq(listings.id, id))
    .returning();

  if (!row) {
    return null;
  }

  const settings = await getSettings(db);
  return serializeListing(row, getOfficeLocation(settings), settings);
}

export async function listListingsForEvaluation(db: Database) {
  const rows = await db
    .select()
    .from(listings)
    .where(inArray(listings.userStatus, ["NEW", "REVIEWED"]))
    .orderBy(desc(listings.lastSeenAt));

  return rows.map((row) => ({
    ...serializeListing(row),
    semanticInputFingerprint: row.semanticInputFingerprint,
    semanticLastErrorKind: parseLlmErrorKind(row.semanticLastErrorKind),
    semanticLastErrorAt: row.semanticLastErrorAt,
    llmLastErrorKind: parseLlmErrorKind(row.llmLastErrorKind)
  }));
}

export async function getSettings(db: Database): Promise<AppSettings> {
  const row = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, "default")
  });

  if (!row) {
    await db.insert(appSettings).values({
      key: "default",
      data: defaultAppSettings
    });

    return defaultAppSettings;
  }

  return appSettingsSchema.parse(row.data);
}

export async function patchSettings(db: Database, patch: AppSettingsPatch): Promise<AppSettings> {
  const current = await getSettings(db);
  const parsedPatch = appSettingsPatchSchema.parse(patch);

  const merged = appSettingsSchema.parse({
    ...current,
    ...parsedPatch,
    scoring: {
      ...current.scoring,
      ...parsedPatch.scoring
    },
    search: {
      ...current.search,
      ...parsedPatch.search
    },
    semanticRules: {
      ...current.semanticRules,
      ...parsedPatch.semanticRules
    },
    runtime: {
      ...current.runtime,
      ...parsedPatch.runtime
    },
    profile: {
      ...current.profile,
      ...parsedPatch.profile
    }
  });

  await db
    .insert(appSettings)
    .values({
      key: "default",
      data: merged,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: {
        data: merged,
        updatedAt: new Date()
      }
    });

  return merged;
}

export async function getStatsSummary(db: Database) {
  const [totalRow] = await db.select({ count: sql<number>`count(*)::int` }).from(listings);
  const portalRows = await db
    .select({
      portal: listings.portal,
      count: sql<number>`count(*)::int`
    })
    .from(listings)
    .groupBy(listings.portal);

  const statusRows = await db
    .select({
      userStatus: listings.userStatus,
      count: sql<number>`count(*)::int`
    })
    .from(listings)
    .groupBy(listings.userStatus);

  const eligibilityRows = await db
    .select({
      eligibilityState: listings.eligibilityState,
      count: sql<number>`count(*)::int`
    })
    .from(listings)
    .groupBy(listings.eligibilityState);

  return {
    totals: {
      listings: totalRow?.count ?? 0,
      match: eligibilityRows.find((row) => row.eligibilityState === "MATCH")?.count ?? 0,
      unsure: eligibilityRows.find((row) => row.eligibilityState === "UNSURE")?.count ?? 0,
      reject: eligibilityRows.find((row) => row.eligibilityState === "REJECT")?.count ?? 0
    },
    byPortal: Object.fromEntries(portalRows.map((row) => [row.portal, row.count])),
    byStatus: Object.fromEntries(statusRows.map((row) => [row.userStatus, row.count]))
  };
}

export async function getDashboardStats(
  db: Database,
  options: {
    llmProviderConfigured?: boolean;
  } = {}
) {
  const settings = await getSettings(db);
  const officeLocation = getOfficeLocation(settings);
  const rows = await db.select().from(listings);
  const serializedRows = rows.map((row) => serializeListing(row, officeLocation, settings));

  const statusBreakdown = userStatuses.map((status) => ({
    status,
    count: serializedRows.filter((row) => row.userStatus === status).length
  }));

  const eligibilityBreakdown = eligibilityStates.map((eligibility) => ({
    eligibility,
    count: serializedRows.filter((row) => row.eligibilityState === eligibility).length
  }));

  const portalBreakdown = portals.map((portal) => ({
    portal,
    count: serializedRows.filter((row) => row.portal === portal).length
  }));

  const rentBands = rentBandDefinitions.map((band) => ({
    ...band,
    count: serializedRows.filter((row) => {
      const rentValue = row.rentWarm ?? row.rentCold;

      if (rentValue == null) {
        return false;
      }

      if (band.min == null) {
        return rentValue < band.max;
      }

      if (band.max == null) {
        return rentValue >= band.min;
      }

      return rentValue >= band.min && rentValue < band.max;
    }).length
  }));

  const districts = new Map<
    string,
    {
      count: number;
      warmRentTotal: number;
      warmRentCount: number;
      scoreTotal: number;
      scoreCount: number;
    }
  >();

  serializedRows.forEach((row) => {
    if (!row.district) {
      return;
    }

    const next = districts.get(row.district) ?? {
      count: 0,
      warmRentTotal: 0,
      warmRentCount: 0,
      scoreTotal: 0,
      scoreCount: 0
    };

    next.count += 1;

    const rentValue = row.rentWarm ?? row.rentCold;
    if (rentValue != null) {
      next.warmRentTotal += rentValue;
      next.warmRentCount += 1;
    }

    if (row.score != null) {
      next.scoreTotal += row.score;
      next.scoreCount += 1;
    }

    districts.set(row.district, next);
  });

  const topDistricts = [...districts.entries()]
    .map(([district, aggregate]) => ({
      district,
      count: aggregate.count,
      averageWarmRent: aggregate.warmRentCount > 0 ? Number((aggregate.warmRentTotal / aggregate.warmRentCount).toFixed(1)) : null,
      averageScore: aggregate.scoreCount > 0 ? Number((aggregate.scoreTotal / aggregate.scoreCount).toFixed(1)) : null
    }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }

      return (right.averageScore ?? 0) - (left.averageScore ?? 0);
    })
    .slice(0, 6);

  const districtGeoSummary = [...districts.entries()]
    .map(([district, aggregate]) => {
      const centroid = getBerlinDistrictCentroid(district);

      if (!centroid) {
        return null;
      }

      const districtRows = serializedRows.filter((row) => row.district === district);
      const distances = districtRows.map((row) => row.distanceKm).filter((value): value is number => value != null);

      return {
        district,
        count: aggregate.count,
        averageWarmRent:
          aggregate.warmRentCount > 0 ? Number((aggregate.warmRentTotal / aggregate.warmRentCount).toFixed(1)) : null,
        averageScore: aggregate.scoreCount > 0 ? Number((aggregate.scoreTotal / aggregate.scoreCount).toFixed(1)) : null,
        latitude: centroid.latitude,
        longitude: centroid.longitude,
        averageDistanceKm:
          distances.length > 0 ? Number((distances.reduce((sum, value) => sum + value, 0) / distances.length).toFixed(2)) : null
      };
    })
    .filter((item): item is NonNullable<typeof item> => item != null)
    .sort((left, right) => right.count - left.count);

  const distanceBands = distanceBandDefinitions.map((band) => ({
    ...band,
    count: serializedRows.filter((row) => {
      if (row.distanceKm == null) {
        return false;
      }

      if (band.max == null) {
        return row.distanceKm >= band.min;
      }

      return row.distanceKm >= band.min && row.distanceKm < band.max;
    }).length
  }));

  const geoPrecisionBreakdown = [
    {
      precision: "portal_coordinates" as const,
      count: serializedRows.filter((row) => row.geoSource === "portal_coordinates").length
    },
    {
      precision: "district_centroid" as const,
      count: serializedRows.filter((row) => row.geoSource === "district_centroid").length
    },
    {
      precision: "unknown" as const,
      count: serializedRows.filter((row) => row.geoSource == null).length
    }
  ];

  const rentSizePoints = serializedRows.map((row) => ({
    id: row.id,
    title: row.title,
    portal: row.portal,
    userStatus: row.userStatus,
    district: row.district,
    eligibilityState: row.eligibilityState,
    score: row.score,
    rent: row.rentWarm ?? row.rentCold,
    sizeSqm: row.sizeSqm,
    distanceKm: row.distanceKm,
    latitude: row.latitude,
    longitude: row.longitude,
    geoSource: row.geoSource,
    llmAnalysisStatus: row.llmAnalysisStatus
  }));

  const llmHealth = {
    providerConfigured: options.llmProviderConfigured ?? true,
    classifierReady: rows.filter((row) => Boolean(row.semanticInputFingerprint)).length,
    classifierModelBreakdown: buildModelBreakdown(rows),
    classifierError: rows.filter((row) => Boolean(row.semanticLastErrorKind)).length,
    classifierErrorBreakdown: buildLlmErrorBreakdown(rows.map((row) => row.semanticLastErrorKind)),
    analystReady: serializedRows.filter((row) => row.llmAnalysisStatus === "ready").length,
    analystMissing: serializedRows.filter((row) => row.llmAnalysisStatus === "missing").length,
    analystStale: serializedRows.filter((row) => row.llmAnalysisStatus === "stale").length,
    analystError: serializedRows.filter((row) => row.llmAnalysisStatus === "error").length,
    analystErrorBreakdown: buildLlmErrorBreakdown(rows.map((row) => row.llmLastErrorKind))
  };

  return {
    totals: {
      listings: serializedRows.length,
      reviewQueue: serializedRows.filter((row) => row.userStatus === "NEW" || row.userStatus === "REVIEWED").length,
      match: eligibilityBreakdown.find((item) => item.eligibility === "MATCH")?.count ?? 0,
      contacted: statusBreakdown.find((item) => item.status === "CONTACTED")?.count ?? 0,
      unsure: eligibilityBreakdown.find((item) => item.eligibility === "UNSURE")?.count ?? 0,
      reject: eligibilityBreakdown.find((item) => item.eligibility === "REJECT")?.count ?? 0
    },
    statusBreakdown,
    eligibilityBreakdown,
    portalBreakdown,
    rentBands,
    topDistricts,
    districtGeoSummary,
    distanceBands,
    rentSizePoints,
    geoPrecisionBreakdown,
    llmHealth
  };
}

export async function ensurePortalSource(
  db: Database,
  payload: {
    portal: Portal;
    searchUrl: string;
    scrapeIntervalMinutes?: number;
    enabled?: boolean;
    searchParams?: Record<string, unknown>;
  }
) {
  await db
    .insert(portalSources)
    .values({
      portal: payload.portal,
      searchUrl: payload.searchUrl,
      scrapeIntervalMinutes: payload.scrapeIntervalMinutes ?? 30,
      enabled: payload.enabled ?? true,
      searchParams: payload.searchParams ?? {}
    })
    .onConflictDoUpdate({
      target: portalSources.portal,
      set: {
        searchUrl: payload.searchUrl,
        scrapeIntervalMinutes: payload.scrapeIntervalMinutes ?? 30,
        enabled: payload.enabled ?? true,
        searchParams: payload.searchParams ?? {}
      }
    });
}

export async function getPortalSource(db: Database, portal: Portal) {
  const row = await db.query.portalSources.findFirst({
    where: eq(portalSources.portal, portal)
  });

  if (!row) {
    return null;
  }

  const [credentialRow, sessionRow] = await Promise.all([
    getPortalCredentialRow(db, portal),
    getPortalSessionRow(db, portal)
  ]);

  return serializePortalSource(row, credentialRow, sessionRow);
}

export async function listPortalSources(db: Database) {
  const rows = await db.select().from(portalSources).orderBy(portalSources.portal);
  const credentialRows = await db.select().from(portalCredentials);
  const sessionRows = await db.select().from(portalSessions);
  const credentialsByPortal = new Map(credentialRows.map((row) => [row.portal, row] as const));
  const sessionsByPortal = new Map(sessionRows.map((row) => [row.portal, row] as const));

  return rows.map((row) => serializePortalSource(row, credentialsByPortal.get(row.portal), sessionsByPortal.get(row.portal)));
}

export async function updatePortalSource(db: Database, portal: Portal, patch: PortalSourcePatch) {
  const parsedPatch = portalSourcePatchSchema.parse(patch);
  const [row] = await db
    .update(portalSources)
    .set({
      ...parsedPatch
    })
    .where(eq(portalSources.portal, portal))
    .returning();

  if (!row) {
    return null;
  }

  const [credentialRow, sessionRow] = await Promise.all([
    getPortalCredentialRow(db, portal),
    getPortalSessionRow(db, portal)
  ]);

  return serializePortalSource(row, credentialRow, sessionRow);
}

type StoredPortalCredentials = {
  password: string;
};

type PortalSessionStatePayload = Record<string, unknown>;

export async function getPortalSourceAuthSummary(db: Database, portal: Portal) {
  const [credentialRow, sessionRow] = await Promise.all([
    getPortalCredentialRow(db, portal),
    getPortalSessionRow(db, portal)
  ]);

  return serializePortalSourceAuthSummary(portal, credentialRow, sessionRow);
}

export async function putPortalCredentials(
  db: Database,
  portal: Portal,
  payload: PortalSourceAuthUpsert,
  secretKey: string
) {
  const parsed = portalSourceAuthUpsertSchema.parse(payload);
  const encryptedPayload = encryptJson(
    {
      password: parsed.password
    },
    secretKey
  );

  await db
    .insert(portalCredentials)
    .values({
      portal,
      authMode: parsed.authMode,
      loginIdentifier: parsed.loginIdentifier,
      encryptedPayload,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: portalCredentials.portal,
      set: {
        authMode: parsed.authMode,
        loginIdentifier: parsed.loginIdentifier,
        encryptedPayload,
        updatedAt: new Date()
      }
    });

  await db
    .insert(portalSessions)
    .values({
      portal,
      status: "ready",
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: portalSessions.portal,
      set: {
        status: "ready",
        lastAuthError: null,
        lastChallengeType: null,
        updatedAt: new Date()
      }
    });

  return getPortalSourceAuthSummary(db, portal);
}

export async function getDecryptedPortalCredentials<T = StoredPortalCredentials>(
  db: Database,
  portal: Portal,
  secretKey: string
) {
  const row = await getPortalCredentialRow(db, portal);

  if (!row) {
    return null;
  }

  return {
    authMode: row.authMode,
    loginIdentifier: row.loginIdentifier,
    payload: decryptJson<T>(row.encryptedPayload, secretKey)
  };
}

export async function upsertPortalSessionState(
  db: Database,
  portal: Portal,
  payload: {
    storageState: PortalSessionStatePayload | null;
    status: SourceAuthStatus;
    expiresAt?: Date | null;
    lastAuthenticatedAt?: Date | null;
    lastValidatedAt?: Date | null;
    lastAuthError?: string | null;
    lastChallengeType?: string | null;
  },
  secretKey: string
) {
  const encryptedStorageState = payload.storageState ? encryptJson(payload.storageState, secretKey) : null;

  await db
    .insert(portalSessions)
    .values({
      portal,
      encryptedStorageState: encryptedStorageState,
      status: payload.status,
      expiresAt: payload.expiresAt ?? null,
      lastAuthenticatedAt: payload.lastAuthenticatedAt ?? null,
      lastValidatedAt: payload.lastValidatedAt ?? null,
      lastAuthError: payload.lastAuthError ?? null,
      lastChallengeType: payload.lastChallengeType ?? null,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: portalSessions.portal,
      set: {
        encryptedStorageState,
        status: payload.status,
        expiresAt: payload.expiresAt ?? null,
        lastAuthenticatedAt: payload.lastAuthenticatedAt ?? null,
        lastValidatedAt: payload.lastValidatedAt ?? null,
        lastAuthError: payload.lastAuthError ?? null,
        lastChallengeType: payload.lastChallengeType ?? null,
        updatedAt: new Date()
      }
    });

  return getPortalSourceAuthSummary(db, portal);
}

export async function getDecryptedPortalSessionState<T = PortalSessionStatePayload>(
  db: Database,
  portal: Portal,
  secretKey: string
) {
  const row = await getPortalSessionRow(db, portal);

  if (!row || !row.encryptedStorageState) {
    return null;
  }

  return {
    status: row.status,
    expiresAt: row.expiresAt,
    lastAuthenticatedAt: row.lastAuthenticatedAt,
    lastValidatedAt: row.lastValidatedAt,
    lastAuthError: row.lastAuthError,
    lastChallengeType: row.lastChallengeType,
    storageState: decryptJson<T>(row.encryptedStorageState, secretKey)
  };
}

export async function deletePortalSourceAuth(db: Database, portal: Portal) {
  await db.delete(portalSessions).where(eq(portalSessions.portal, portal));
  await db.delete(portalCredentials).where(eq(portalCredentials.portal, portal));

  return getPortalSourceAuthSummary(db, portal);
}

export async function listEnabledPortalSourcesDue(db: Database) {
  const rows = await db.select().from(portalSources).where(eq(portalSources.enabled, true)).orderBy(portalSources.portal);
  const now = Date.now();

  return rows.filter((row) => {
    if (!row.lastRunAt) {
      return true;
    }

    return row.lastRunAt.getTime() + row.scrapeIntervalMinutes * 60_000 <= now;
  });
}

function advisoryLockKeyForPortal(portal: Portal) {
  const index = portals.indexOf(portal);
  return index >= 0 ? index + 1 : 0;
}

export async function tryAdvisoryPortalLock(db: Database, portal: Portal) {
  const lockKey = advisoryLockKeyForPortal(portal);
  const result = await db.execute(sql`SELECT pg_try_advisory_lock(${lockKey}) AS locked`);
  const row = result.rows[0] as { locked?: boolean } | undefined;
  return Boolean(row?.locked);
}

export async function releaseAdvisoryPortalLock(db: Database, portal: Portal) {
  const lockKey = advisoryLockKeyForPortal(portal);
  await db.execute(sql`SELECT pg_advisory_unlock(${lockKey})`);
}

export async function markPortalRun(
  db: Database,
  portal: Portal,
  payload: {
    mode: SourceRunMode;
    status: SourceRunStatus;
    listingsFound: number;
    listingsUpserted: number;
    failedDetails: number;
    errorMessage?: string | null;
  }
) {
  await db
    .update(portalSources)
    .set({
      lastRunAt: new Date(),
      lastSuccessAt: payload.status === "failed" ? undefined : new Date(),
      lastError: payload.status === "success" ? null : payload.errorMessage ?? "Unknown scraping error",
      lastMode: payload.mode,
      lastStatus: payload.status,
      lastListingsFound: payload.listingsFound,
      lastListingsUpserted: payload.listingsUpserted,
      lastFailedDetails: payload.failedDetails
    })
    .where(eq(portalSources.portal, portal));
}

export async function getCachedGeoSearch(db: Database, query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return null;
  }

  const row = await db.query.geocodeCache.findFirst({
    where: eq(geocodeCache.query, normalizedQuery)
  });

  return row
    ? {
        results: row.results,
        updatedAt: row.updatedAt.toISOString()
      }
    : null;
}

export async function upsertGeoSearchCache(db: Database, query: string, results: GeoSearchResult[]) {
  const normalizedQuery = query.trim().toLowerCase();

  const [row] = await db
    .insert(geocodeCache)
    .values({
      query: normalizedQuery,
      results,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: geocodeCache.query,
      set: {
        results,
        updatedAt: new Date()
      }
    })
    .returning();

  return {
    results: row.results,
    updatedAt: row.updatedAt.toISOString()
  };
}
