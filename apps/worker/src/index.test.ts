import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectDb: vi.fn(),
  getSettings: vi.fn(),
  listEnabledPortalSourcesDue: vi.fn(),
  getPortalSource: vi.fn(),
  tryAdvisoryPortalLock: vi.fn(),
  releaseAdvisoryPortalLock: vi.fn(),
  getDecryptedPortalCredentials: vi.fn(),
  getDecryptedPortalSessionState: vi.fn(),
  upsertListing: vi.fn(),
  markPortalRun: vi.fn(),
  upsertPortalSessionState: vi.fn(),
  updatePortalSource: vi.fn(),
  listListingsForEvaluation: vi.fn(),
  updateListingEvaluation: vi.fn(),
  ensureDefaultPortalSources: vi.fn(),
  getSourceAdapter: vi.fn(),
  classifyListingEligibility: vi.fn(),
  buildSemanticClassificationFingerprint: vi.fn(),
  evaluateListingDeterministically: vi.fn()
}));

vi.mock("@flathunter/db", () => ({
  connectDb: mocks.connectDb,
  getSettings: mocks.getSettings,
  listEnabledPortalSourcesDue: mocks.listEnabledPortalSourcesDue,
  getPortalSource: mocks.getPortalSource,
  tryAdvisoryPortalLock: mocks.tryAdvisoryPortalLock,
  releaseAdvisoryPortalLock: mocks.releaseAdvisoryPortalLock,
  getDecryptedPortalCredentials: mocks.getDecryptedPortalCredentials,
  getDecryptedPortalSessionState: mocks.getDecryptedPortalSessionState,
  upsertListing: mocks.upsertListing,
  markPortalRun: mocks.markPortalRun,
  upsertPortalSessionState: mocks.upsertPortalSessionState,
  updatePortalSource: mocks.updatePortalSource,
  listListingsForEvaluation: mocks.listListingsForEvaluation,
  updateListingEvaluation: mocks.updateListingEvaluation
}));

vi.mock("./sources/registry", () => ({
  ensureDefaultPortalSources: mocks.ensureDefaultPortalSources,
  getSourceAdapter: mocks.getSourceAdapter
}));

vi.mock("./services/semantic", () => ({
  classifyListingEligibility: mocks.classifyListingEligibility,
  buildSemanticClassificationFingerprint: mocks.buildSemanticClassificationFingerprint
}));

vi.mock("@flathunter/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flathunter/shared")>();

  return {
    ...actual,
    evaluateListingDeterministically: mocks.evaluateListingDeterministically
  };
});

describe("runWorkerOnce", () => {
  const db = { tag: "db" };
  const pool = {
    end: vi.fn().mockResolvedValue(undefined)
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mocks.connectDb.mockReturnValue({ db, pool });
    mocks.getSettings.mockResolvedValue({
      runtime: {
        scrapeWithFixtures: false,
        enableSemanticClassifier: false,
        enableLlmEnrichment: false,
        llmProvider: "gemini",
        llmClassifierModel: "gemini-2.5-flash-lite",
        llmAnalystModel: "gemini-2.5-flash"
      }
    });
    mocks.listEnabledPortalSourcesDue.mockResolvedValue([{ portal: "IMMOWELT" }, { portal: "WG_GESUCHT" }]);
    mocks.getPortalSource.mockImplementation(async (_db, portal) => ({
      portal,
      enabled: true,
      searchUrl: `https://example.com/${String(portal).toLowerCase()}`,
      searchParams: {}
    }));
    mocks.tryAdvisoryPortalLock.mockResolvedValue(true);
    mocks.releaseAdvisoryPortalLock.mockResolvedValue(undefined);
    mocks.getDecryptedPortalCredentials.mockResolvedValue(null);
    mocks.getDecryptedPortalSessionState.mockResolvedValue(null);
    mocks.upsertListing.mockResolvedValue(undefined);
    mocks.markPortalRun.mockResolvedValue(undefined);
    mocks.upsertPortalSessionState.mockResolvedValue(undefined);
    mocks.updatePortalSource.mockResolvedValue(undefined);
    mocks.listListingsForEvaluation.mockResolvedValue([
      {
        id: "listing-1",
        title: "Sunny flat",
        description: null,
        semanticFlags: [],
        semanticModel: null,
        llmAnalysis: null,
        llmAnalysisStatus: "missing",
        analysisFlags: [],
        semanticInputFingerprint: null,
        llmLastErrorKind: null
      }
    ]);
    mocks.updateListingEvaluation.mockResolvedValue(undefined);
    mocks.ensureDefaultPortalSources.mockResolvedValue(undefined);
    mocks.classifyListingEligibility.mockResolvedValue({
      eligibilityState: "UNSURE",
      reason: "Semantic classifier unavailable",
      flags: [],
      inputFingerprint: "test-fingerprint",
      usedFallback: true,
      errorKind: "timeout",
      didRetry: true
    });
    mocks.buildSemanticClassificationFingerprint.mockReturnValue("test-fingerprint");
    mocks.evaluateListingDeterministically.mockReturnValue({
      score: 77,
      eligibilityState: "UNSURE",
      reason: "needs review",
      analysisFlags: [],
      shouldRunSemanticClassifier: false
    });
  });

  it("processes due sources independently and continues after a source failure", async () => {
    const adapterByPortal = {
      IMMOWELT: {
        capabilities: {
          requiresAuthSetup: false
        },
        scrape: vi.fn().mockResolvedValue({
          listings: [
            {
              portal: "IMMOWELT",
              portalListingId: "iw-1",
              url: "https://www.immowelt.de/expose/iw-1",
              canonicalUrl: "https://www.immowelt.de/expose/iw-1",
              title: "Flat 1",
              description: null,
              addressLine: null,
              city: "Berlin",
              district: "Mitte",
              neighborhood: null,
              latitude: null,
              longitude: null,
              rentCold: 1200,
              rentWarm: null,
              sizeSqm: 55,
              rooms: 2,
              floor: null,
              availableFrom: null,
              isFurnished: false,
              hasBalcony: false,
              hasElevator: false,
              rawPayload: { source: "live" }
            }
          ],
          listingsFound: 1,
          failedDetails: 0,
          detailFailures: {
            blocked: 0,
            invalid: 0,
            error: 0
          },
          mode: "live",
          authStatus: "session_valid",
          authError: null,
          challengeType: null,
          sessionState: null,
          sessionExpiresAt: null,
          authenticatedAt: null,
          validatedAt: new Date("2026-03-31T20:00:00.000Z")
        }),
        cleanup: vi.fn().mockResolvedValue(undefined)
      },
      WG_GESUCHT: {
        capabilities: {
          requiresAuthSetup: true
        },
        scrape: vi.fn().mockRejectedValue(new Error("source exploded")),
        cleanup: vi.fn().mockResolvedValue(undefined)
      }
    } as const;

    mocks.getSourceAdapter.mockImplementation((portal: keyof typeof adapterByPortal) => adapterByPortal[portal]);

    const { runWorkerOnce } = await import("./index");

    await runWorkerOnce({
      envInput: {
        NODE_ENV: "test",
        DATABASE_URL: "postgres://unused",
        PORTAL_SECRETS_KEY: "portal-secrets-key-for-tests",
        GEMINI_API_KEY: "gemini-test-key",
        GEMINI_API_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
        IMMOWELT_SEARCH_URL: "https://www.immowelt.de/liste/berlin/wohnungen/mieten",
        IMMOWELT_ENABLE_LIVE_BROWSER: "true",
        WORKER_DEV_INTERVAL_MS: "300000"
      }
    });

    expect(mocks.ensureDefaultPortalSources).toHaveBeenCalledTimes(1);
    expect(adapterByPortal.IMMOWELT.scrape).toHaveBeenCalledTimes(1);
    expect(adapterByPortal.WG_GESUCHT.scrape).toHaveBeenCalledTimes(1);
    expect(mocks.upsertListing).toHaveBeenCalledTimes(1);
    expect(mocks.markPortalRun).toHaveBeenCalledWith(
      db,
      "IMMOWELT",
      expect.objectContaining({
        status: "success",
        listingsFound: 1,
        listingsUpserted: 1
      })
    );
    expect(mocks.markPortalRun).toHaveBeenCalledWith(
      db,
      "WG_GESUCHT",
      expect.objectContaining({
        status: "failed",
        errorMessage: "source exploded"
      })
    );
    expect(mocks.updateListingEvaluation).toHaveBeenCalledWith(
      db,
      "listing-1",
      expect.objectContaining({
        score: 77,
        eligibilityReason: "needs review"
      })
    );
    expect(mocks.releaseAdvisoryPortalLock).toHaveBeenCalledTimes(2);
    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it("disables auth-required sources when scraping hits an auth or challenge failure", async () => {
    const adapterByPortal = {
      WG_GESUCHT: {
        capabilities: {
          requiresAuthSetup: true
        },
        scrape: vi.fn().mockResolvedValue({
          listings: [],
          listingsFound: 0,
          failedDetails: 0,
          detailFailures: {
            blocked: 0,
            invalid: 0,
            error: 0
          },
          mode: "live",
          authStatus: "challenge_required",
          authError: "Search page returned an unavailable, blocked, or robot challenge response",
          challengeType: "anti_bot",
          sessionState: null,
          sessionExpiresAt: null,
          authenticatedAt: null,
          validatedAt: new Date("2026-03-31T20:00:00.000Z")
        }),
        cleanup: vi.fn().mockResolvedValue(undefined)
      }
    } as const;

    mocks.listEnabledPortalSourcesDue.mockResolvedValue([{ portal: "WG_GESUCHT" }]);
    mocks.getSourceAdapter.mockImplementation((portal: keyof typeof adapterByPortal) => adapterByPortal[portal]);

    const { runWorkerOnce } = await import("./index");

    await runWorkerOnce({
      envInput: {
        NODE_ENV: "test",
        DATABASE_URL: "postgres://unused",
        PORTAL_SECRETS_KEY: "portal-secrets-key-for-tests",
        GEMINI_API_KEY: "gemini-test-key",
        GEMINI_API_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
        IMMOWELT_SEARCH_URL: "https://www.immowelt.de/liste/berlin/wohnungen/mieten",
        IMMOWELT_ENABLE_LIVE_BROWSER: "true",
        WORKER_DEV_INTERVAL_MS: "300000"
      }
    });

    expect(mocks.updatePortalSource).toHaveBeenCalledWith(db, "WG_GESUCHT", {
      enabled: false
    });
  });

  it("does not force all portals into fixture mode when Immowelt live mode is disabled", async () => {
    const wgAdapter = {
      capabilities: {
        requiresAuthSetup: true
      },
      scrape: vi.fn().mockResolvedValue({
        listings: [],
        listingsFound: 0,
        failedDetails: 0,
        detailFailures: {
          blocked: 0,
          invalid: 0,
          error: 0
        },
        mode: "live",
        authStatus: "session_valid",
        authError: null,
        challengeType: null,
        sessionState: null,
        sessionExpiresAt: null,
        authenticatedAt: null,
        validatedAt: new Date("2026-03-31T20:00:00.000Z")
      }),
      cleanup: vi.fn().mockResolvedValue(undefined)
    };

    mocks.listEnabledPortalSourcesDue.mockResolvedValue([{ portal: "WG_GESUCHT" }]);
    mocks.getSourceAdapter.mockReturnValue(wgAdapter);

    const { runWorkerOnce } = await import("./index");

    await runWorkerOnce({
      envInput: {
        NODE_ENV: "test",
        DATABASE_URL: "postgres://unused",
        PORTAL_SECRETS_KEY: "portal-secrets-key-for-tests",
        GEMINI_API_KEY: "gemini-test-key",
        GEMINI_API_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
        IMMOWELT_SEARCH_URL: "https://www.immowelt.de/liste/berlin/wohnungen/mieten",
        IMMOWELT_ENABLE_LIVE_BROWSER: "false",
        WORKER_DEV_INTERVAL_MS: "300000"
      }
    });

    expect(wgAdapter.scrape).toHaveBeenCalledWith(
      expect.objectContaining({
        scrapeWithFixtures: false
      })
    );
  });

  it("disables and skips retired sources before execution", async () => {
    mocks.listEnabledPortalSourcesDue.mockResolvedValue([{ portal: "IMMOSCOUT24" }]);

    const { runWorkerOnce } = await import("./index");

    await runWorkerOnce({
      envInput: {
        NODE_ENV: "test",
        DATABASE_URL: "postgres://unused",
        PORTAL_SECRETS_KEY: "portal-secrets-key-for-tests",
        GEMINI_API_KEY: "gemini-test-key",
        GEMINI_API_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
        IMMOWELT_SEARCH_URL: "https://www.immowelt.de/liste/berlin/wohnungen/mieten",
        IMMOWELT_ENABLE_LIVE_BROWSER: "true",
        WORKER_DEV_INTERVAL_MS: "300000"
      }
    });

    expect(mocks.updatePortalSource).toHaveBeenCalledWith(db, "IMMOSCOUT24", {
      enabled: false
    });
    expect(mocks.getSourceAdapter).not.toHaveBeenCalled();
    expect(mocks.markPortalRun).not.toHaveBeenCalled();
  });

  it("skips sources whose advisory lock is already held", async () => {
    mocks.listEnabledPortalSourcesDue.mockResolvedValue([{ portal: "IMMOWELT" }, { portal: "WG_GESUCHT" }]);
    mocks.tryAdvisoryPortalLock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const wgAdapter = {
      capabilities: {
        requiresAuthSetup: true
      },
      scrape: vi.fn().mockResolvedValue({
        listings: [],
        listingsFound: 0,
        failedDetails: 0,
        detailFailures: {
          blocked: 0,
          invalid: 0,
          error: 0
        },
        mode: "fixture",
        authStatus: "ready",
        authError: null,
        challengeType: null,
        sessionState: null,
        sessionExpiresAt: null,
        authenticatedAt: null,
        validatedAt: new Date("2026-03-31T20:00:00.000Z")
      }),
      cleanup: vi.fn().mockResolvedValue(undefined)
    };
    mocks.getSourceAdapter.mockImplementation((portal: string) => {
      if (portal === "WG_GESUCHT") {
        return wgAdapter;
      }

      return {
        capabilities: {
          requiresAuthSetup: false
        },
        scrape: vi.fn(),
        cleanup: vi.fn()
      };
    });

    const { runWorkerOnce } = await import("./index");

    await runWorkerOnce({
      envInput: {
        NODE_ENV: "test",
        DATABASE_URL: "postgres://unused",
        PORTAL_SECRETS_KEY: "portal-secrets-key-for-tests",
        GEMINI_API_KEY: "gemini-test-key",
        GEMINI_API_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
        IMMOWELT_SEARCH_URL: "https://www.immowelt.de/liste/berlin/wohnungen/mieten",
        IMMOWELT_ENABLE_LIVE_BROWSER: "true",
        WORKER_DEV_INTERVAL_MS: "300000"
      }
    });

    expect(wgAdapter.scrape).toHaveBeenCalledTimes(1);
    expect(mocks.markPortalRun).toHaveBeenCalledTimes(1);
    expect(mocks.releaseAdvisoryPortalLock).toHaveBeenCalledTimes(1);
  });

  it("reuses cached llm analysis when the fingerprint and model still match", async () => {
    mocks.listEnabledPortalSourcesDue.mockResolvedValue([]);
    mocks.getSettings.mockResolvedValue({
      runtime: {
        scrapeWithFixtures: false,
        enableSemanticClassifier: true,
        enableLlmEnrichment: true,
        llmProvider: "gemini",
        llmClassifierModel: "gemini-2.5-flash-lite",
        llmAnalystModel: "gemini-2.5-flash"
      }
    });
    mocks.listListingsForEvaluation.mockResolvedValue([
      {
        id: "listing-1",
        title: "Sunny flat",
        description: "Balcony and elevator in Berlin",
        eligibilityState: "MATCH",
        eligibilityReason: "cached analyst verdict",
        semanticFlags: ["balcony_mentioned", "elevator_mentioned"],
        semanticModel: "gemini-2.5-flash-lite",
        semanticInputFingerprint: "test-fingerprint",
        llmLastErrorKind: null,
        llmAnalysis: {
          sourceLanguage: "de",
          translatedTitle: "Sunny flat",
          translatedDescription: "Balcony and elevator in Berlin",
          summary: "Bright apartment with two strong amenity signals.",
          fitNote: "Cached analysis already marked this listing as a fit.",
          model: "gemini-2.5-flash",
          translationModel: null,
          promptVersion: "english-analyst-v2",
          inputFingerprint: "test-fingerprint",
          updatedAt: "2026-04-03T12:00:00.000Z"
        },
        llmAnalysisStatus: "ready",
        analysisFlags: []
      }
    ]);
    mocks.evaluateListingDeterministically.mockReturnValue({
      score: 88,
      eligibilityState: "UNSURE",
      reason: "needs review",
      analysisFlags: [],
      shouldRunSemanticClassifier: true
    });

    const { runWorkerOnce } = await import("./index");

    await runWorkerOnce({
      envInput: {
        NODE_ENV: "test",
        DATABASE_URL: "postgres://unused",
        PORTAL_SECRETS_KEY: "portal-secrets-key-for-tests",
        GEMINI_API_KEY: "gemini-test-key",
        GEMINI_API_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
        IMMOWELT_SEARCH_URL: "https://www.immowelt.de/liste/berlin/wohnungen/mieten",
        IMMOWELT_ENABLE_LIVE_BROWSER: "true",
        WORKER_DEV_INTERVAL_MS: "300000"
      }
    });

    expect(mocks.classifyListingEligibility).not.toHaveBeenCalled();
    expect(mocks.updateListingEvaluation).toHaveBeenCalledWith(
      db,
      "listing-1",
      expect.objectContaining({
        score: 88,
        eligibilityState: "MATCH",
        eligibilityReason: "cached analyst verdict",
        semanticFlags: ["balcony_mentioned", "elevator_mentioned"],
        semanticModel: "gemini-2.5-flash-lite"
      })
    );
  });

  it("applies deterministic fallback output without marking the classifier cache ready", async () => {
    mocks.listEnabledPortalSourcesDue.mockResolvedValue([]);
    mocks.getSettings.mockResolvedValue({
      runtime: {
        scrapeWithFixtures: false,
        enableSemanticClassifier: true,
        enableLlmEnrichment: true,
        llmProvider: "gemini",
        llmClassifierModel: "gemini-2.5-flash-lite",
        llmAnalystModel: "gemini-2.5-flash"
      }
    });
    mocks.listListingsForEvaluation.mockResolvedValue([
      {
        id: "listing-1",
        title: "Sunny flat",
        description: "Large apartment in Mitte",
        eligibilityState: "UNSURE",
        eligibilityReason: null,
        semanticFlags: [],
        semanticModel: null,
        semanticInputFingerprint: null,
        semanticLastErrorKind: null,
        llmLastErrorKind: null,
        llmAnalysis: null,
        llmAnalysisStatus: "missing",
        analysisFlags: []
      }
    ]);
    mocks.evaluateListingDeterministically.mockReturnValue({
      score: 91,
      eligibilityState: "UNSURE",
      reason: "needs review",
      analysisFlags: [],
      shouldRunSemanticClassifier: true
    });
    mocks.classifyListingEligibility.mockResolvedValue({
      eligibilityState: "MATCH",
      reason: "Semantic classifier rate limit; deterministic fallback match: score 91.",
      flags: [],
      inputFingerprint: "test-fingerprint",
      usedFallback: true,
      errorKind: "rate_limit",
      didRetry: true
    });

    const { runWorkerOnce } = await import("./index");

    await runWorkerOnce({
      envInput: {
        NODE_ENV: "test",
        DATABASE_URL: "postgres://unused",
        PORTAL_SECRETS_KEY: "portal-secrets-key-for-tests",
        GEMINI_API_KEY: "gemini-test-key",
        GEMINI_API_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
        IMMOWELT_SEARCH_URL: "https://www.immowelt.de/liste/berlin/wohnungen/mieten",
        IMMOWELT_ENABLE_LIVE_BROWSER: "true",
        WORKER_DEV_INTERVAL_MS: "300000"
      }
    });

    expect(mocks.updateListingEvaluation).toHaveBeenCalledWith(
      db,
      "listing-1",
      expect.objectContaining({
        eligibilityState: "MATCH",
        eligibilityReason: "Semantic classifier rate limit; deterministic fallback match: score 91.",
        semanticModel: null,
        semanticInputFingerprint: null,
        semanticLastErrorKind: "rate_limit",
        semanticLastErrorAt: expect.any(Date)
      })
    );
  });

  it("stops classifier calls for the current run after a rate limit", async () => {
    mocks.listEnabledPortalSourcesDue.mockResolvedValue([]);
    mocks.getSettings.mockResolvedValue({
      runtime: {
        scrapeWithFixtures: false,
        enableSemanticClassifier: true,
        enableLlmEnrichment: true,
        llmProvider: "gemini",
        llmClassifierModel: "gemini-2.5-flash",
        llmAnalystModel: "gemini-2.5-flash"
      }
    });
    mocks.listListingsForEvaluation.mockResolvedValue([
      {
        id: "listing-1",
        title: "First flat",
        description: "Large apartment in Mitte",
        eligibilityState: "UNSURE",
        eligibilityReason: null,
        semanticFlags: [],
        semanticModel: null,
        semanticInputFingerprint: null,
        semanticLastErrorKind: null,
        llmLastErrorKind: null,
        llmAnalysis: null,
        llmAnalysisStatus: "missing",
        analysisFlags: []
      },
      {
        id: "listing-2",
        title: "Second flat",
        description: "Large apartment in Mitte",
        eligibilityState: "UNSURE",
        eligibilityReason: null,
        semanticFlags: [],
        semanticModel: null,
        semanticInputFingerprint: null,
        semanticLastErrorKind: null,
        llmLastErrorKind: null,
        llmAnalysis: null,
        llmAnalysisStatus: "missing",
        analysisFlags: []
      }
    ]);
    mocks.evaluateListingDeterministically.mockReturnValue({
      score: 74,
      eligibilityState: "UNSURE",
      reason: "needs review",
      analysisFlags: [],
      shouldRunSemanticClassifier: true
    });
    mocks.classifyListingEligibility.mockResolvedValue({
      eligibilityState: "UNSURE",
      reason: "Semantic classifier rate limit; needs review",
      flags: [],
      inputFingerprint: "test-fingerprint",
      usedFallback: true,
      errorKind: "rate_limit",
      didRetry: false
    });

    const { runWorkerOnce } = await import("./index");

    await runWorkerOnce({
      envInput: {
        NODE_ENV: "test",
        DATABASE_URL: "postgres://unused",
        PORTAL_SECRETS_KEY: "portal-secrets-key-for-tests",
        GEMINI_API_KEY: "gemini-test-key",
        GEMINI_API_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
        IMMOWELT_SEARCH_URL: "https://www.immowelt.de/liste/berlin/wohnungen/mieten",
        IMMOWELT_ENABLE_LIVE_BROWSER: "true",
        WORKER_DEV_INTERVAL_MS: "300000"
      }
    });

    expect(mocks.classifyListingEligibility).toHaveBeenCalledTimes(1);
    expect(mocks.updateListingEvaluation).toHaveBeenCalledWith(
      db,
      "listing-1",
      expect.objectContaining({
        semanticLastErrorKind: "rate_limit"
      })
    );
    expect(mocks.updateListingEvaluation).toHaveBeenCalledWith(
      db,
      "listing-2",
      expect.objectContaining({
        eligibilityState: "UNSURE",
        eligibilityReason: "needs review"
      })
    );
  });

  it("respects the configured classifier call budget per run", async () => {
    mocks.listEnabledPortalSourcesDue.mockResolvedValue([]);
    mocks.getSettings.mockResolvedValue({
      runtime: {
        scrapeWithFixtures: false,
        enableSemanticClassifier: true,
        enableLlmEnrichment: true,
        llmProvider: "gemini",
        llmClassifierModel: "gemini-2.5-flash",
        llmAnalystModel: "gemini-2.5-flash"
      }
    });
    mocks.listListingsForEvaluation.mockResolvedValue([
      {
        id: "listing-1",
        title: "First flat",
        description: "Large apartment in Mitte",
        eligibilityState: "UNSURE",
        eligibilityReason: null,
        semanticFlags: [],
        semanticModel: null,
        semanticInputFingerprint: null,
        semanticLastErrorKind: null,
        semanticLastErrorAt: null,
        llmLastErrorKind: null,
        llmAnalysis: null,
        llmAnalysisStatus: "missing",
        analysisFlags: []
      },
      {
        id: "listing-2",
        title: "Second flat",
        description: "Large apartment in Mitte",
        eligibilityState: "UNSURE",
        eligibilityReason: null,
        semanticFlags: [],
        semanticModel: null,
        semanticInputFingerprint: null,
        semanticLastErrorKind: null,
        semanticLastErrorAt: null,
        llmLastErrorKind: null,
        llmAnalysis: null,
        llmAnalysisStatus: "missing",
        analysisFlags: []
      }
    ]);
    mocks.evaluateListingDeterministically.mockReturnValue({
      score: 74,
      eligibilityState: "UNSURE",
      reason: "needs review",
      analysisFlags: [],
      shouldRunSemanticClassifier: true
    });
    mocks.classifyListingEligibility.mockResolvedValue({
      eligibilityState: "MATCH",
      reason: "Good match",
      flags: ["LONG_TERM"],
      inputFingerprint: "test-fingerprint",
      usedFallback: false,
      errorKind: null,
      didRetry: false
    });

    const { runWorkerOnce } = await import("./index");

    await runWorkerOnce({
      envInput: {
        NODE_ENV: "test",
        DATABASE_URL: "postgres://unused",
        PORTAL_SECRETS_KEY: "portal-secrets-key-for-tests",
        GEMINI_API_KEY: "gemini-test-key",
        GEMINI_API_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
        GEMINI_CLASSIFIER_MAX_PER_RUN: "1",
        GEMINI_CLASSIFIER_MIN_DELAY_MS: "0",
        IMMOWELT_SEARCH_URL: "https://www.immowelt.de/liste/berlin/wohnungen/mieten",
        IMMOWELT_ENABLE_LIVE_BROWSER: "true",
        WORKER_DEV_INTERVAL_MS: "300000"
      }
    });

    expect(mocks.classifyListingEligibility).toHaveBeenCalledTimes(1);
    expect(mocks.updateListingEvaluation).toHaveBeenCalledWith(
      db,
      "listing-1",
      expect.objectContaining({
        eligibilityState: "MATCH",
        semanticInputFingerprint: "test-fingerprint"
      })
    );
    expect(mocks.updateListingEvaluation).toHaveBeenCalledWith(
      db,
      "listing-2",
      expect.objectContaining({
        eligibilityState: "UNSURE",
        eligibilityReason: "needs review"
      })
    );
  });

  it("does not retry recent rate-limited classifier errors during cooldown", async () => {
    mocks.listEnabledPortalSourcesDue.mockResolvedValue([]);
    mocks.getSettings.mockResolvedValue({
      runtime: {
        scrapeWithFixtures: false,
        enableSemanticClassifier: true,
        enableLlmEnrichment: true,
        llmProvider: "gemini",
        llmClassifierModel: "gemini-2.5-flash",
        llmAnalystModel: "gemini-2.5-flash"
      }
    });
    mocks.listListingsForEvaluation.mockResolvedValue([
      {
        id: "listing-1",
        title: "Rate limited flat",
        description: "Large apartment in Mitte",
        eligibilityState: "UNSURE",
        eligibilityReason: "Previous rate limit",
        semanticFlags: [],
        semanticModel: null,
        semanticInputFingerprint: null,
        semanticLastErrorKind: "rate_limit",
        semanticLastErrorAt: new Date(),
        llmLastErrorKind: null,
        llmAnalysis: null,
        llmAnalysisStatus: "missing",
        analysisFlags: []
      }
    ]);
    mocks.evaluateListingDeterministically.mockReturnValue({
      score: 74,
      eligibilityState: "UNSURE",
      reason: "needs review",
      analysisFlags: [],
      shouldRunSemanticClassifier: true
    });

    const { runWorkerOnce } = await import("./index");

    await runWorkerOnce({
      envInput: {
        NODE_ENV: "test",
        DATABASE_URL: "postgres://unused",
        PORTAL_SECRETS_KEY: "portal-secrets-key-for-tests",
        GEMINI_API_KEY: "gemini-test-key",
        GEMINI_API_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
        GEMINI_CLASSIFIER_RETRY_COOLDOWN_MS: "1800000",
        IMMOWELT_SEARCH_URL: "https://www.immowelt.de/liste/berlin/wohnungen/mieten",
        IMMOWELT_ENABLE_LIVE_BROWSER: "true",
        WORKER_DEV_INTERVAL_MS: "300000"
      }
    });

    expect(mocks.classifyListingEligibility).not.toHaveBeenCalled();
    expect(mocks.updateListingEvaluation).toHaveBeenCalledWith(
      db,
      "listing-1",
      expect.objectContaining({
        eligibilityState: "UNSURE",
        eligibilityReason: "needs review"
      })
    );
  });
});
