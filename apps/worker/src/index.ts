import {
  connectDb,
  getDecryptedPortalCredentials,
  getDecryptedPortalSessionState,
  getPortalSource,
  getSettings,
  listEnabledPortalSourcesDue,
  listListingsForEvaluation,
  markPortalRun,
  releaseAdvisoryPortalLock,
  tryAdvisoryPortalLock,
  updatePortalSource,
  updateListingEvaluation,
  upsertListing,
  upsertPortalSessionState
} from "@flathunter/db";
import {
  evaluateListingDeterministically,
  formatRuntimeError,
  getRecommendedLlmTimeoutProfile,
  isActiveSourcePortal,
  type Portal,
  type SourceRunStatus
} from "@flathunter/shared";
import { pathToFileURL } from "node:url";

import { readWorkerEnv } from "./config";
import { log } from "./lib/logger";
import { buildSemanticClassificationFingerprint, classifyListingEligibility } from "./services/semantic";
import { ensureDefaultPortalSources, getSourceAdapter } from "./sources/registry";
import type { SourceCredentials, SourceScrapeResult, SourceSessionState } from "./sources/types";

type RunWorkerOptions = {
  envInput?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
};

function deriveSourceRunStatus(result: SourceScrapeResult, upsertedCount: number): SourceRunStatus {
  if (result.authStatus === "challenge_required" || result.authStatus === "auth_failed") {
    return result.listingsFound > 0 || upsertedCount > 0 ? "partial" : "failed";
  }

  if (result.failedDetails > 0) {
    return "partial";
  }

  return "success";
}

function formatSourceRunMessage(result: SourceScrapeResult, status: SourceRunStatus) {
  const parts: string[] = [];

  if (result.authError) {
    parts.push(result.authError);
  }

  if (result.detailFailures.blocked > 0) {
    parts.push(`${result.detailFailures.blocked} blocked detail pages`);
  }

  if (result.detailFailures.invalid > 0) {
    parts.push(`${result.detailFailures.invalid} invalid or non-listing detail pages`);
  }

  if (result.detailFailures.error > 0) {
    parts.push(`${result.detailFailures.error} detail fetch errors`);
  }

  if (parts.length === 0) {
    return status === "success" ? null : "Unknown scraping error";
  }

  if (status === "partial" && (result.listingsFound > 0 || result.listings.length > 0)) {
    return `Listings were ingested, but the latest run had ${parts.join(", ")}.`;
  }

  return parts.join(", ");
}

async function evaluateReviewQueue({
  db,
  env,
  fetchImpl
}: {
  db: ReturnType<typeof connectDb>["db"];
  env: ReturnType<typeof readWorkerEnv>;
  fetchImpl: typeof fetch;
}) {
  const settings = await getSettings(db);
  const candidates = await listListingsForEvaluation(db);
  const semanticClassifierConfigured = Boolean(env.GEMINI_API_KEY?.trim());
  let stopSemanticClassifierForRun = !semanticClassifierConfigured;

  for (const candidate of candidates) {
    const deterministic = evaluateListingDeterministically(candidate, settings);
    let eligibilityState = deterministic.eligibilityState;
    let eligibilityReason = deterministic.reason;
    let semanticFlags: string[] = candidate.semanticFlags;
    let semanticModel: string | null = candidate.semanticModel;

    const semanticClassifierEnabled = settings.runtime.enableSemanticClassifier && deterministic.shouldRunSemanticClassifier;
    const inputFingerprint = buildSemanticClassificationFingerprint(candidate, settings, {
      deterministicScore: deterministic.score,
      deterministicReason: deterministic.reason,
      analysisFlags: deterministic.analysisFlags
    });
    const canReuseCachedClassification =
      semanticClassifierEnabled &&
      candidate.semanticInputFingerprint === inputFingerprint &&
      candidate.semanticModel === settings.runtime.llmClassifierModel;

    if (canReuseCachedClassification) {
      semanticFlags = candidate.semanticFlags;
      semanticModel = candidate.semanticModel;

      eligibilityState = candidate.eligibilityState;
      eligibilityReason = candidate.eligibilityReason ?? deterministic.reason;
    }

    let semanticInputFingerprint: string | null | undefined;
    let semanticUpdatedAt: Date | null | undefined;
    let semanticLastErrorKind = undefined;
    let semanticLastErrorAt = undefined;

    if (semanticClassifierEnabled && !canReuseCachedClassification && !stopSemanticClassifierForRun) {
      const timeouts = getRecommendedLlmTimeoutProfile(
        settings.runtime.llmClassifierModel,
        settings.runtime.llmAnalystModel
      );
      const semantic = await classifyListingEligibility(candidate, settings, {
        deterministicScore: deterministic.score,
        deterministicReason: deterministic.reason,
        analysisFlags: deterministic.analysisFlags
      }, {
        apiKey: env.GEMINI_API_KEY,
        baseUrl: env.GEMINI_API_BASE_URL,
        classifierModel: settings.runtime.llmClassifierModel,
        analystModel: settings.runtime.llmAnalystModel,
        fetchImpl,
        timeoutMs: timeouts.classificationTimeoutMs,
        retryTimeoutMs: timeouts.classificationRetryTimeoutMs
      });

      if (!semantic.usedFallback) {
        semanticFlags = semantic.flags;
        semanticModel = settings.runtime.llmClassifierModel;
        eligibilityState = semantic.eligibilityState;
        eligibilityReason = semantic.reason;
        semanticInputFingerprint = semantic.inputFingerprint;
        semanticUpdatedAt = new Date();
        semanticLastErrorKind = null;
        semanticLastErrorAt = null;
      } else {
        semanticFlags = semantic.flags;
        semanticModel = null;
        eligibilityState = semantic.eligibilityState;
        eligibilityReason = semantic.reason;
        semanticInputFingerprint = null;
        semanticUpdatedAt = null;
        semanticLastErrorKind = semantic.errorKind;
        semanticLastErrorAt = semantic.errorKind ? new Date() : null;

        if (semantic.errorKind === "rate_limit" || semantic.errorKind === "auth_error" || semantic.errorKind === "http_error") {
          stopSemanticClassifierForRun = true;
        }
      }
    } else if (canReuseCachedClassification) {
      semanticLastErrorKind = null;
      semanticLastErrorAt = null;
    }

    await updateListingEvaluation(db, candidate.id, {
      score: deterministic.score,
      eligibilityState,
      eligibilityReason,
      analysisFlags: deterministic.analysisFlags,
      semanticFlags,
      semanticModel,
      semanticInputFingerprint,
      semanticUpdatedAt,
      semanticLastErrorKind,
      semanticLastErrorAt
    });
  }

  return candidates.length;
}

async function runPortalBatch({
  portal,
  env,
  db,
  fetchImpl,
  scrapeWithFixtures
}: {
  portal: Portal;
  env: ReturnType<typeof readWorkerEnv>;
  db: ReturnType<typeof connectDb>["db"];
  fetchImpl: typeof fetch;
  scrapeWithFixtures: boolean;
}) {
  if (!isActiveSourcePortal(portal)) {
    await updatePortalSource(db, portal, {
      enabled: false
    }).catch(() => {});

    log("retired source skipped", {
      portal
    });
    return;
  }

  const source = await getPortalSource(db, portal);

  if (!source?.enabled) {
    log("source disabled or missing, skipping", {
      portal
    });
    return;
  }

  const lockAcquired = await tryAdvisoryPortalLock(db, portal);

  if (!lockAcquired) {
    log("source lock already held, skipping run", {
      portal
    });
    return;
  }

  try {
    const settings = await getSettings(db);
    const adapter = getSourceAdapter(portal);
    const [storedCredentials, storedSession] = await Promise.all([
      getDecryptedPortalCredentials<{ password: string }>(db, portal, env.PORTAL_SECRETS_KEY),
      getDecryptedPortalSessionState<SourceSessionState>(db, portal, env.PORTAL_SECRETS_KEY)
    ]);
    const credentials: SourceCredentials | null = storedCredentials
      ? {
          loginIdentifier: storedCredentials.loginIdentifier,
          password: storedCredentials.payload.password
        }
      : null;

    const result = await adapter.scrape({
      env,
      settings,
      searchUrl: source.searchUrl,
      searchParams: source.searchParams ?? {},
      scrapeWithFixtures,
      sessionState: storedSession?.storageState ?? null,
      credentials,
      fetchImpl
    });

    let upsertedCount = 0;

    for (const listing of result.listings) {
      await upsertListing(db, listing);
      upsertedCount += 1;
    }

    await adapter.cleanup?.({
      db,
      portal,
      runMode: result.mode,
      listingsFound: result.listingsFound,
      listingsUpserted: upsertedCount
    });

    const status = deriveSourceRunStatus(result, upsertedCount);
    const errorMessage = formatSourceRunMessage(result, status);

    await upsertPortalSessionState(
      db,
      portal,
      {
        storageState: result.sessionState,
        status: result.authStatus,
        expiresAt: result.sessionExpiresAt,
        lastAuthenticatedAt: result.authenticatedAt,
        lastValidatedAt: result.validatedAt,
        lastAuthError: result.authError,
        lastChallengeType: result.challengeType
      },
      env.PORTAL_SECRETS_KEY
    );

    await markPortalRun(db, portal, {
      mode: result.mode,
      status,
      listingsFound: result.listingsFound,
      listingsUpserted: upsertedCount,
      failedDetails: result.failedDetails,
      errorMessage
    });

    if (adapter.capabilities.requiresAuthSetup && (result.authStatus === "challenge_required" || result.authStatus === "auth_failed")) {
      await updatePortalSource(db, portal, {
        enabled: false
      });
    }

    log("source batch completed", {
      portal,
      runMode: result.mode,
      authStatus: result.authStatus,
      status,
      listingsFound: result.listingsFound,
      upsertedCount,
      failedDetails: result.failedDetails
    });
  } catch (error) {
    const errorMessage = formatRuntimeError(error);

    await upsertPortalSessionState(
      db,
      portal,
      {
        storageState: null,
        status: "auth_failed",
        lastValidatedAt: new Date(),
        lastAuthError: errorMessage,
        lastChallengeType: null
      },
      env.PORTAL_SECRETS_KEY
    ).catch(() => {});

    await markPortalRun(db, portal, {
      mode: scrapeWithFixtures ? "fixture" : "live",
      status: "failed",
      listingsFound: 0,
      listingsUpserted: 0,
      failedDetails: 0,
      errorMessage
    }).catch(() => {});

    log("source batch failed", {
      portal,
      error: errorMessage
    });
  } finally {
    await releaseAdvisoryPortalLock(db, portal).catch(() => {});
  }
}

export async function runWorkerOnce({ envInput, fetchImpl = fetch }: RunWorkerOptions = {}) {
  const env = readWorkerEnv(envInput);
  const { db, pool } = connectDb(env.DATABASE_URL);

  try {
    const settings = await getSettings(db);
    const scrapeWithFixtures = settings.runtime.scrapeWithFixtures;

    await ensureDefaultPortalSources(db, settings, env);

    const dueSources = await listEnabledPortalSourcesDue(db);

    for (const source of dueSources) {
      if (!isActiveSourcePortal(source.portal)) {
        await updatePortalSource(db, source.portal, {
          enabled: false
        });

        log("retired source disabled and skipped", {
          portal: source.portal
        });
        continue;
      }

      await runPortalBatch({
        portal: source.portal,
        env,
        db,
        fetchImpl,
        scrapeWithFixtures
      });
    }

    const evaluated = await evaluateReviewQueue({
      db,
      env,
      fetchImpl
    });

    log("worker completed", {
      evaluated,
      sourcesProcessed: dueSources.length
    });
  } finally {
    await pool.end();
  }
}

async function main() {
  await runWorkerOnce();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  });
}
