import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { buildAnalysisInputFingerprint, canonicalizeListingUrl } from "@flathunter/shared";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";

import type { Database } from "./client";
import {
  deleteInvalidLiveListings,
  deleteFixtureListings,
  deletePortalSourceAuth,
  ensurePortalSource,
  getDecryptedPortalCredentials,
  getSettings,
  getPortalSourceAuthSummary,
  getDashboardStats,
  getListingById,
  applyDuplicateAssignments,
  clearListingDuplicate,
  createContactAttempt,
  listDedupCandidates,
  listContactAttemptsByListing,
  listListings,
  listPortalSources,
  markPortalRun,
  patchSettings,
  resetListingsIngestionState,
  updateListingEvaluation,
  putPortalCredentials,
  updateListingLlmState,
  upsertPortalSessionState,
  updatePortalSource,
  upsertListing
} from "./repositories";
import * as schema from "./schema";

function toPgLiteSafeMigration(migration: string) {
  return migration.replace(/DO \$\$ BEGIN\s+(CREATE TYPE[\s\S]*?;)\s+EXCEPTION[\s\S]*?END \$\$;/g, "$1");
}

async function applyMigrations(exec: (sql: string) => Promise<unknown>) {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(currentDir, "../drizzle/migrations");
  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();

  for (const file of files) {
    const migration = await fs.readFile(path.join(migrationsDir, file), "utf8");
    await exec(toPgLiteSafeMigration(migration));
  }
}

async function createTestDb() {
  const client = new PGlite();
  await applyMigrations((sql) => client.exec(sql));

  return drizzle(client, { schema }) as unknown as Database;
}

describe("repositories", { timeout: 20_000 }, () => {
  it("upserts a listing by portal listing id", async () => {
    const db = await createTestDb();

    await upsertListing(db, {
      portal: "IMMOWELT",
      portalListingId: "abc",
      url: "https://www.immowelt.de/expose/abc?foo=1",
      canonicalUrl: canonicalizeListingUrl("https://www.immowelt.de/expose/abc?foo=1"),
      title: "Original title",
      description: null,
      addressLine: null,
      city: "Berlin",
      district: "Mitte",
      neighborhood: null,
      latitude: null,
      longitude: null,
      rentCold: 1200,
      rentWarm: 1400,
      sizeSqm: 65,
      rooms: 2,
      floor: null,
      availableFrom: null,
      isFurnished: false,
      hasBalcony: false,
      hasElevator: false,
      rawPayload: null
    });

    await upsertListing(db, {
      portal: "IMMOWELT",
      portalListingId: "abc",
      url: "https://www.immowelt.de/expose/abc?foo=2",
      canonicalUrl: canonicalizeListingUrl("https://www.immowelt.de/expose/abc?foo=2"),
      title: "Updated title",
      description: null,
      addressLine: null,
      city: "Berlin",
      district: "Mitte",
      neighborhood: null,
      latitude: null,
      longitude: null,
      rentCold: 1200,
      rentWarm: 1450,
      sizeSqm: 66,
      rooms: 2,
      floor: null,
      availableFrom: null,
      isFurnished: false,
      hasBalcony: false,
      hasElevator: false,
      rawPayload: null
    });

    const listings = await listListings(db, {});

    expect(listings).toHaveLength(1);
    expect(listings[0]?.title).toBe("Updated title");
    expect(listings[0]?.rentWarm).toBe(1450);
    expect(listings[0]?.sourceMode).toBeNull();
  });

  it("records contact attempts and flips the listing to CONTACTED", async () => {
    const db = await createTestDb();

    const listing = await upsertListing(db, {
      portal: "INBERLINWOHNEN",
      portalListingId: "ESQ 1/2/3",
      url: "https://www.howoge.de/detail/1-2-3.html",
      canonicalUrl: "https://www.howoge.de/detail/1-2-3.html",
      title: "Stadteigene Wohnung",
      description: "3 Zimmer",
      addressLine: "Teststr. 1, 10318 Lichtenberg",
      city: "Berlin",
      district: "Lichtenberg",
      neighborhood: null,
      latitude: null,
      longitude: null,
      rentCold: 600,
      rentWarm: 800,
      sizeSqm: 60,
      rooms: 3,
      floor: null,
      availableFrom: null,
      isFurnished: false,
      hasBalcony: true,
      hasElevator: false,
      rawPayload: null
    });

    const attempt = await createContactAttempt(db, listing.id, {
      channel: "EMAIL",
      status: "SENT",
      messageSubject: "Bewerbung Wohnung Lichtenberg",
      messageBody: "Sehr geehrte Damen und Herren, ...",
      errorMessage: null
    });

    expect(attempt).toMatchObject({
      listingId: listing.id,
      channel: "EMAIL",
      status: "SENT",
      messageSubject: "Bewerbung Wohnung Lichtenberg"
    });

    const updated = await getListingById(db, listing.id);
    expect(updated?.userStatus).toBe("CONTACTED");

    const history = await listContactAttemptsByListing(db, listing.id);
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe(attempt?.id);

    // FAILED attempts are recorded but do not flip the status back.
    const failed = await createContactAttempt(db, listing.id, {
      channel: "PORTAL_FORM",
      status: "FAILED",
      messageSubject: null,
      messageBody: null,
      errorMessage: "form submit failed"
    });

    expect(failed?.status).toBe("FAILED");
    expect(await listContactAttemptsByListing(db, listing.id)).toHaveLength(2);

    const missing = await createContactAttempt(db, 99999, {
      channel: "EMAIL",
      status: "SENT",
      messageSubject: null,
      messageBody: null,
      errorMessage: null
    });
    expect(missing).toBeNull();
  });

  it("flags cross-portal duplicates and hides them from default listings", async () => {
    const db = await createTestDb();

    const base = {
      title: "Same flat",
      description: null,
      addressLine: "Teststr. 5, 10318 Berlin",
      city: "Berlin",
      district: "Lichtenberg",
      neighborhood: null,
      latitude: 52.49,
      longitude: 13.52,
      rentCold: 700,
      rentWarm: 900,
      sizeSqm: 70,
      rooms: 3,
      floor: null,
      availableFrom: null,
      isFurnished: false,
      hasBalcony: false,
      hasElevator: false,
      rawPayload: null
    };

    const original = await upsertListing(db, {
      ...base,
      portal: "IMMOWELT",
      portalListingId: "dup-a",
      url: "https://www.immowelt.de/expose/dup-a",
      canonicalUrl: "https://www.immowelt.de/expose/dup-a"
    });

    const copy = await upsertListing(db, {
      ...base,
      portal: "KLEINANZEIGEN",
      portalListingId: "dup-b",
      url: "https://www.kleinanzeigen.de/s-anzeige/dup-b",
      canonicalUrl: "https://www.kleinanzeigen.de/s-anzeige/dup-b"
    });

    const candidates = await listDedupCandidates(db);
    expect(candidates).toHaveLength(2);

    const flagged = await applyDuplicateAssignments(db, new Map([[copy.id, original.id]]));
    expect(flagged).toBe(1);

    // Re-applying the same assignment is a no-op.
    expect(await applyDuplicateAssignments(db, new Map([[copy.id, original.id]]))).toBe(0);

    const defaultList = await listListings(db, {});
    expect(defaultList.map((listing) => listing.id)).toEqual([original.id]);

    const fullList = await listListings(db, { includeDuplicates: true });
    expect(fullList).toHaveLength(2);
    expect(fullList.find((listing) => listing.id === copy.id)?.duplicateOfListingId).toBe(original.id);

    const cleared = await clearListingDuplicate(db, copy.id);
    expect(cleared?.duplicateOfListingId).toBeNull();
    expect(await listListings(db, {})).toHaveLength(2);
  });

  it("merges app settings patches", async () => {
    const db = await createTestDb();
    const settings = await patchSettings(db, {
      scoring: {
        maxWarmRent: 2000
      },
      runtime: {
        scrapeWithFixtures: false
      }
    });

    expect(settings.scoring.maxWarmRent).toBe(2000);
    expect(settings.runtime.scrapeWithFixtures).toBe(false);
    expect(settings.search.city).toBe("Berlin");
  });

  it("resets listings and source run history without clearing settings or auth", async () => {
    const db = await createTestDb();

    await patchSettings(db, {
      scoring: {
        maxWarmRent: 2150
      }
    });
    await ensurePortalSource(db, {
      portal: "IMMOWELT",
      searchUrl: "https://www.immowelt.de/liste/berlin/wohnungen/mieten"
    });
    await markPortalRun(db, "IMMOWELT", {
      mode: "live",
      status: "success",
      listingsFound: 1,
      listingsUpserted: 1,
      failedDetails: 0,
      errorMessage: null
    });
    await putPortalCredentials(
      db,
      "IMMOWELT",
      {
        authMode: "FORM_CREDENTIALS",
        loginIdentifier: "hello@example.com",
        password: "super-secret"
      },
      "portal-secrets-key-for-tests"
    );
    await upsertListing(db, {
      portal: "IMMOWELT",
      portalListingId: "reset-1",
      url: "https://www.immowelt.de/expose/reset-1",
      canonicalUrl: canonicalizeListingUrl("https://www.immowelt.de/expose/reset-1"),
      title: "Listing to reset",
      description: null,
      addressLine: null,
      city: "Berlin",
      district: "Mitte",
      neighborhood: null,
      latitude: null,
      longitude: null,
      rentCold: 1200,
      rentWarm: 1400,
      sizeSqm: 60,
      rooms: 2,
      floor: null,
      availableFrom: null,
      isFurnished: false,
      hasBalcony: false,
      hasElevator: false,
      rawPayload: {
        source: "live"
      }
    });

    const result = await resetListingsIngestionState(db);
    const sources = await listPortalSources(db);
    const authSummary = await getPortalSourceAuthSummary(db, "IMMOWELT");

    expect(result).toEqual({
      deletedListings: 1,
      resetSources: 1
    });
    expect(await listListings(db, {})).toHaveLength(0);
    expect((await getSettings(db)).scoring.maxWarmRent).toBe(2150);
    expect(sources[0]).toMatchObject({
      portal: "IMMOWELT",
      lastRunAt: null,
      lastSuccessAt: null,
      lastError: null,
      lastMode: null,
      lastStatus: null,
      lastListingsFound: null,
      lastListingsUpserted: null,
      lastFailedDetails: null
    });
    expect(authSummary).toMatchObject({
      hasCredentials: true,
      authStatus: "ready",
      loginIdentifier: "hello@example.com"
    });
  });

  it("computes dashboard analytics from listings", async () => {
    const db = await createTestDb();

    const firstListing = await upsertListing(db, {
      portal: "IMMOWELT",
      portalListingId: "dashboard-1",
      url: "https://www.immowelt.de/expose/dashboard-1",
      canonicalUrl: canonicalizeListingUrl("https://www.immowelt.de/expose/dashboard-1"),
      title: "Quiet Friedrichshain apartment",
      description: null,
      addressLine: null,
      city: "Berlin",
      district: "Friedrichshain",
      neighborhood: null,
      latitude: null,
      longitude: null,
      rentCold: 1300,
      rentWarm: 1520,
      sizeSqm: 61,
      rooms: 2,
      floor: null,
      availableFrom: null,
      isFurnished: false,
      hasBalcony: true,
      hasElevator: false,
      rawPayload: null
    });

    const secondListing = await upsertListing(db, {
      portal: "IMMOWELT",
      portalListingId: "dashboard-2",
      url: "https://www.immowelt.de/expose/dashboard-2",
      canonicalUrl: canonicalizeListingUrl("https://www.immowelt.de/expose/dashboard-2"),
      title: "Prenzlauer Berg family home",
      description: null,
      addressLine: null,
      city: "Berlin",
      district: "Prenzlauer Berg",
      neighborhood: null,
      latitude: null,
      longitude: null,
      rentCold: 1450,
      rentWarm: 1780,
      sizeSqm: 76,
      rooms: 3,
      floor: null,
      availableFrom: null,
      isFurnished: false,
      hasBalcony: true,
      hasElevator: true,
      rawPayload: null
    });

    await patchSettings(db, {
      search: {
        officeLocation: {
          label: "Alexanderplatz",
          address: "Alexanderplatz 1, Berlin",
          latitude: 52.5219,
          longitude: 13.4132,
          district: "Mitte",
          provider: "nominatim",
          updatedAt: new Date().toISOString()
        }
      }
    });
    await updateListingEvaluation(db, firstListing.id, {
      score: 82,
      eligibilityState: "MATCH",
      eligibilityReason: "Gemma cached match",
      analysisFlags: [],
      semanticFlags: ["LONG_TERM"],
      semanticModel: "gemma-4-26b-a4b-it",
      semanticInputFingerprint: "fingerprint-gemma",
      semanticUpdatedAt: new Date()
    });
    await updateListingEvaluation(db, secondListing.id, {
      score: 88,
      eligibilityState: "MATCH",
      eligibilityReason: "Flash fallback cached match",
      analysisFlags: [],
      semanticFlags: ["LONG_TERM"],
      semanticModel: "gemini-2.5-flash",
      semanticInputFingerprint: "fingerprint-flash",
      semanticUpdatedAt: new Date()
    });

    const stats = await getDashboardStats(db);
    const serializedListings = await listListings(db, {});

    expect(stats.totals.listings).toBe(2);
    expect(stats.totals.reviewQueue).toBe(2);
    expect(stats.portalBreakdown.find((item) => item.portal === "IMMOWELT")?.count).toBe(2);
    expect(stats.rentBands.find((item) => item.label === "1500-1800")?.count).toBe(2);
    expect(stats.topDistricts).toHaveLength(2);
    expect(stats.districtGeoSummary.find((item) => item.district === "Friedrichshain")?.latitude).toBeTypeOf("number");
    expect(stats.distanceBands.some((item) => item.count > 0)).toBe(true);
    expect(stats.rentSizePoints).toHaveLength(2);
    expect(stats.llmHealth).toEqual({
      providerConfigured: true,
      classifierReady: 2,
      classifierModelBreakdown: [
        {
          model: "gemma-4-26b-a4b-it",
          count: 1
        },
        {
          model: "gemini-2.5-flash",
          count: 1
        }
      ],
      classifierError: 0,
      classifierErrorBreakdown: [],
      analystReady: 0,
      analystMissing: 2,
      analystStale: 0,
      analystError: 0,
      analystErrorBreakdown: []
    });
    expect(stats.geoPrecisionBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          precision: "district_centroid",
          count: 2
        })
      ])
    );
    expect(serializedListings.every((listing) => listing.distanceKm != null)).toBe(true);
    expect(serializedListings.every((listing) => listing.llmAnalysisStatus === "missing")).toBe(true);
  });

  it("lists and updates portal sources", async () => {
    const db = await createTestDb();

    await ensurePortalSource(db, {
      portal: "IMMOWELT",
      searchUrl: "https://www.immowelt.de/liste/berlin/wohnungen/mieten",
      enabled: true,
      scrapeIntervalMinutes: 30
    });

    const sources = await listPortalSources(db);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      portal: "IMMOWELT",
      capabilities: {
        sourceKind: "scraping",
        readiness: "primary",
        cloudCompatible: true,
        requiresAuthSetup: false
      }
    });

    const updated = await updatePortalSource(db, "IMMOWELT", {
      enabled: false,
      scrapeIntervalMinutes: 45
    });

    expect(updated?.enabled).toBe(false);
    expect(updated?.scrapeIntervalMinutes).toBe(45);
  });

  it("derives ready from the canonical analysis fingerprint and stays ready when score changes", async () => {
    const db = await createTestDb();

    const listing = await upsertListing(db, {
      portal: "IMMOWELT",
      portalListingId: "ready-1",
      url: "https://www.immowelt.de/expose/ready-1",
      canonicalUrl: "https://www.immowelt.de/expose/ready-1",
      title: "Bright apartment",
      description: "Long-term rental in Mitte.",
      addressLine: null,
      city: "Berlin",
      district: "Mitte",
      neighborhood: null,
      latitude: null,
      longitude: null,
      rentCold: 1200,
      rentWarm: 1400,
      sizeSqm: 60,
      rooms: 2,
      floor: null,
      availableFrom: null,
      isFurnished: false,
      hasBalcony: false,
      hasElevator: false,
      rawPayload: null
    });

    const settings = await getSettings(db);
    const fingerprint = buildAnalysisInputFingerprint(listing, settings);
    const analysis = {
      sourceLanguage: "German",
      translatedTitle: "Bright apartment",
      translatedDescription: "Long-term rental in Mitte.",
      summary: "2-room apartment in Mitte.",
      fitNote: "Meets all core search criteria.",
      model: "deterministic",
      translationModel: null,
      promptVersion: "classification-v3",
      inputFingerprint: fingerprint,
      updatedAt: new Date().toISOString()
    };

    await updateListingLlmState(db, listing.id, {
      llmAnalysis: analysis,
      llmLastErrorKind: null,
      llmLastErrorAt: null
    });

    let [serialized] = await listListings(db, {});
    expect(serialized?.llmAnalysisStatus).toBe("ready");

    // Score is time-varying (freshness bonus) and must not flip a ready analysis to stale.
    await updateListingEvaluation(db, listing.id, {
      score: 5,
      eligibilityState: "MATCH",
      eligibilityReason: "still ready",
      analysisFlags: [],
      semanticFlags: [],
      semanticModel: null
    });

    [serialized] = await listListings(db, {});
    expect(serialized?.llmAnalysisStatus).toBe("ready");

    await updateListingLlmState(db, listing.id, {
      llmAnalysis: { ...analysis, inputFingerprint: "outdated-fingerprint" },
      llmLastErrorKind: null,
      llmLastErrorAt: null
    });

    [serialized] = await listListings(db, {});
    expect(serialized?.llmAnalysisStatus).toBe("stale");
  });

  it("treats analyst timeout without cached output as missing so the UI can retry cleanly", async () => {
    const db = await createTestDb();

    const listing = await upsertListing(db, {
      portal: "IMMOWELT",
      portalListingId: "timeout-1",
      url: "https://www.immowelt.de/expose/timeout-1",
      canonicalUrl: "https://www.immowelt.de/expose/timeout-1",
      title: "Long local model run",
      description: "Needs an analyst refresh after a timeout.",
      addressLine: null,
      city: "Berlin",
      district: "Mitte",
      neighborhood: null,
      latitude: null,
      longitude: null,
      rentCold: 1200,
      rentWarm: 1400,
      sizeSqm: 60,
      rooms: 2,
      floor: null,
      availableFrom: null,
      isFurnished: false,
      hasBalcony: false,
      hasElevator: false,
      rawPayload: null
    });

    await updateListingLlmState(db, listing.id, {
      llmAnalysis: null,
      llmLastErrorKind: "timeout",
      llmLastErrorAt: new Date()
    });

    const [serialized] = await listListings(db, {});

    expect(serialized?.llmAnalysisStatus).toBe("missing");
  });

  it("stores last run health snapshots for sources", async () => {
    const db = await createTestDb();

    await ensurePortalSource(db, {
      portal: "IMMOWELT",
      searchUrl: "https://www.immowelt.de/liste/berlin/wohnungen/mieten"
    });

    await markPortalRun(db, "IMMOWELT", {
      mode: "live",
      status: "partial",
      listingsFound: 7,
      listingsUpserted: 5,
      failedDetails: 2,
      errorMessage: "2 detail pages failed during the run"
    });

    const [source] = await listPortalSources(db);

    expect(source).toMatchObject({
      portal: "IMMOWELT",
      lastMode: "live",
      lastStatus: "partial",
      lastListingsFound: 7,
      lastListingsUpserted: 5,
      lastFailedDetails: 2
    });
  });

  it("normalizes legacy Immowelt blocked-detail partial runs in source summaries", async () => {
    const db = await createTestDb();

    await ensurePortalSource(db, {
      portal: "IMMOWELT",
      searchUrl: "https://www.immowelt.de/liste/berlin/wohnungen/mieten"
    });

    await markPortalRun(db, "IMMOWELT", {
      mode: "live",
      status: "partial",
      listingsFound: 32,
      listingsUpserted: 32,
      failedDetails: 32,
      errorMessage: "Listings were ingested, but the latest run had 32 blocked detail pages."
    });

    const [source] = await listPortalSources(db);

    expect(source).toMatchObject({
      portal: "IMMOWELT",
      lastMode: "live",
      lastStatus: "success",
      lastError: null,
      lastListingsFound: 32,
      lastListingsUpserted: 32,
      lastFailedDetails: 0
    });
  });

  it("hides raw listing upsert SQL in source summaries", async () => {
    const db = await createTestDb();

    await ensurePortalSource(db, {
      portal: "WG_GESUCHT",
      searchUrl: "https://www.wg-gesucht.de/wohnungen-in-Berlin.8.2.1.0.html"
    });

    await markPortalRun(db, "WG_GESUCHT", {
      mode: "live",
      status: "failed",
      listingsFound: 0,
      listingsUpserted: 0,
      failedDetails: 0,
      errorMessage:
        'Failed query: insert into "listings" ("id") values (default) on conflict ("portal","portal_listing_id") do update set "updated_at" = $1'
    });

    const [source] = await listPortalSources(db);

    expect(source).toMatchObject({
      portal: "WG_GESUCHT",
      lastStatus: "failed",
      lastError: "The last run failed while saving listings to the database."
    });
  });

  it("encrypts credentials and session state for source auth", async () => {
    const db = await createTestDb();

    await ensurePortalSource(db, {
      portal: "IMMOWELT",
      searchUrl: "https://www.immowelt.de/liste/berlin/wohnungen/mieten"
    });

    const storedAuth = await putPortalCredentials(
      db,
      "IMMOWELT",
      {
        authMode: "FORM_CREDENTIALS",
        loginIdentifier: "hello@example.com",
        password: "super-secret"
      },
      "portal-secrets-key-for-tests"
    );

    expect(storedAuth).toMatchObject({
      portal: "IMMOWELT",
      hasCredentials: true,
      authStatus: "ready",
      loginIdentifier: "hello@example.com"
    });

    const decryptedCredentials = await getDecryptedPortalCredentials<{ password: string }>(
      db,
      "IMMOWELT",
      "portal-secrets-key-for-tests"
    );

    expect(decryptedCredentials).toMatchObject({
      loginIdentifier: "hello@example.com",
      payload: {
        password: "super-secret"
      }
    });

    await upsertPortalSessionState(
      db,
      "IMMOWELT",
      {
        storageState: {
          cookies: [],
          origins: []
        },
        status: "session_valid",
        lastAuthenticatedAt: new Date("2026-03-31T10:00:00.000Z"),
        lastValidatedAt: new Date("2026-03-31T10:05:00.000Z"),
        lastAuthError: null,
        lastChallengeType: null
      },
      "portal-secrets-key-for-tests"
    );

    const summary = await getPortalSourceAuthSummary(db, "IMMOWELT");
    expect(summary).toMatchObject({
      portal: "IMMOWELT",
      hasCredentials: true,
      authStatus: "session_valid",
      capabilities: {
        sourceKind: "scraping",
        readiness: "primary",
        cloudCompatible: true,
        requiresAuthSetup: false
      }
    });

    const deleted = await deletePortalSourceAuth(db, "IMMOWELT");
    expect(deleted).toMatchObject({
      portal: "IMMOWELT",
      hasCredentials: false,
      authStatus: "missing_credentials"
    });
  });

  it("derives source mode from stored raw payload and removes invalid live and synthetic fixture listings", async () => {
    const db = await createTestDb();

    await upsertListing(db, {
      portal: "IMMOWELT",
      portalListingId: "iw-berlin-001",
      url: "https://www.immowelt.de/expose/iw-berlin-001",
      canonicalUrl: canonicalizeListingUrl("https://www.immowelt.de/expose/iw-berlin-001"),
      title: "Fixture listing",
      description: null,
      addressLine: null,
      city: "Berlin",
      district: "Mitte",
      neighborhood: null,
      latitude: null,
      longitude: null,
      rentCold: null,
      rentWarm: 1500,
      sizeSqm: 60,
      rooms: 2,
      floor: null,
      availableFrom: null,
      isFurnished: false,
      hasBalcony: false,
      hasElevator: false,
      rawPayload: {
        source: "fixture"
      }
    });

    await upsertListing(db, {
      portal: "IMMOWELT",
      portalListingId: "live-001",
      url: "https://www.immowelt.de/expose/live-001",
      canonicalUrl: canonicalizeListingUrl("https://www.immowelt.de/expose/live-001"),
      title: "Live listing",
      description: null,
      addressLine: "Karl-Marx-Allee 1, Berlin",
      city: "Berlin",
      district: "Friedrichshain",
      neighborhood: null,
      latitude: 52.5209,
      longitude: 13.4388,
      geoSource: "portal_coordinates",
      rentCold: null,
      rentWarm: 1750,
      sizeSqm: 72,
      rooms: 3,
      floor: null,
      availableFrom: null,
      isFurnished: false,
      hasBalcony: true,
      hasElevator: false,
      rawPayload: {
        source: "live"
      }
    });

    await upsertListing(db, {
      portal: "IMMOWELT",
      portalListingId: null,
      url: "https://immowelt.go.link/51hzi",
      canonicalUrl: canonicalizeListingUrl("https://immowelt.go.link/51hzi"),
      title: "Store promo",
      description: null,
      addressLine: null,
      city: null,
      district: null,
      neighborhood: null,
      latitude: null,
      longitude: null,
      rentCold: null,
      rentWarm: null,
      sizeSqm: null,
      rooms: null,
      floor: null,
      availableFrom: null,
      isFurnished: false,
      hasBalcony: false,
      hasElevator: false,
      rawPayload: {
        source: "live"
      }
    });

    const beforeCleanup = await listListings(db, {});

    expect(beforeCleanup).toHaveLength(3);
    expect(beforeCleanup.find((listing) => listing.portalListingId === "iw-berlin-001")?.sourceMode).toBe("fixture");
    expect(beforeCleanup.find((listing) => listing.portalListingId === "live-001")?.sourceMode).toBe("live");
    expect(beforeCleanup.find((listing) => listing.url === "https://immowelt.go.link/51hzi")?.sourceMode).toBe("live");

    const deletedInvalidLive = await deleteInvalidLiveListings(db, "IMMOWELT");
    const deleted = await deleteFixtureListings(db, "IMMOWELT");
    const afterCleanup = await listListings(db, {});

    expect(deletedInvalidLive).toBe(1);
    expect(deleted).toBe(1);
    expect(afterCleanup).toHaveLength(1);
    expect(afterCleanup[0]?.portalListingId).toBe("live-001");
  });
});
