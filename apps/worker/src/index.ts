import {
  applyDuplicateAssignments,
  connectDb,
  getDecryptedPortalCredentials,
  getDecryptedPortalSessionState,
  getDistrictPriceBaselines,
  listDedupCandidates,
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
  findDuplicatePairs,
  formatRuntimeError,
  getRecommendedLlmTimeoutProfile,
  isActiveSourcePortal,
  type LlmAnalysis,
  type Portal,
  type SourceRunStatus
} from "@flathunter/shared";
import { pathToFileURL } from "node:url";

import { readWorkerEnv } from "./config";
import { log } from "./lib/logger";
import { enrichListingCommutes } from "./services/commute";
import {
  buildAnalysisInputFingerprint,
  buildDeterministicTemplateAnalysis,
  buildSemanticClassificationFingerprint,
  classifyListingEligibility
} from "./services/semantic";
import { ensureDefaultPortalSources, getSourceAdapter } from "./sources/registry";
import type { SourceCredentials, SourceScrapeResult, SourceSessionState } from "./sources/types";

type RunWorkerOptions = {
  envInput?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
};

const retryableClassifierErrors = new Set(["rate_limit", "timeout", "transport_error", "http_error", "auth_error"]);

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isClassifierCooldownActive({
  errorKind,
  errorAt,
  cooldownMs,
  now
}: {
  errorKind: string | null | undefined;
  errorAt: Date | null | undefined;
  cooldownMs: number;
  now: Date;
}) {
  if (!errorKind || !errorAt || cooldownMs <= 0 || !retryableClassifierErrors.has(errorKind)) {
    return false;
  }

  return now.getTime() - errorAt.getTime() < cooldownMs;
}

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
  fetchImpl,
  sleepImpl
}: {
  db: ReturnType<typeof connectDb>["db"];
  env: ReturnType<typeof readWorkerEnv>;
  fetchImpl: typeof fetch;
  sleepImpl: (ms: number) => Promise<void>;
}) {
  const settings = await getSettings(db);
  const candidates = await listListingsForEvaluation(db);
  const districtPriceBaselines = await getDistrictPriceBaselines(db);
  const provider = settings.runtime.llmProvider;

  // Resolve API key for the selected classifier provider.
  const classifierApiKey =
    provider === "groq"
      ? env.GROQ_API_KEY
      : provider === "cerebras"
        ? env.CEREBRAS_API_KEY
        : env.GEMINI_API_KEY;
  const classifierBaseUrl =
    provider === "groq"
      ? env.GROQ_API_BASE_URL
      : provider === "cerebras"
        ? env.CEREBRAS_API_BASE_URL
        : env.GEMINI_API_BASE_URL;

  const semanticClassifierConfigured = Boolean(classifierApiKey?.trim());
  let stopSemanticClassifierForRun = !semanticClassifierConfigured;
  let stopClassifierFallbackForRun = false;
  let semanticClassifierCalls = 0;
  let semanticClassifierFallbackCalls = 0;
  let lastSemanticClassifierCallAt = 0;

  for (const candidate of candidates) {
    const deterministic = evaluateListingDeterministically(candidate, settings, {
      commuteMinutes: candidate.commuteMinutes,
      firstSeenAt: candidate.firstSeenAt,
      districtMedianRentPerSqm: candidate.district
        ? districtPriceBaselines.get(candidate.district.trim().toLowerCase()) ?? null
        : null
    });
    let eligibilityState = deterministic.eligibilityState;
    let eligibilityReason = deterministic.reason;
    let semanticFlags: string[] = candidate.semanticFlags;
    let semanticModel: string | null = candidate.semanticModel;
    let semanticFitScore: number | null | undefined = undefined;
    let llmAnalysis: LlmAnalysis | null | undefined = undefined;

    const semanticClassifierEnabled = settings.runtime.enableSemanticClassifier && deterministic.shouldRunSemanticClassifier;
    const inputFingerprint = buildSemanticClassificationFingerprint(candidate, settings, deterministic.analysisFlags);
    const analysisFingerprint = buildAnalysisInputFingerprint(candidate, settings);
    const canReuseCachedClassification =
      semanticClassifierEnabled &&
      candidate.semanticInputFingerprint === inputFingerprint;

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

    // Deterministic MATCH/REJECT verdicts get a cheap template analysis (no LLM):
    // MATCH with MyMemory translation, REJECT without (not worth the quota).
    // Skipped when the stored analysis already carries the current fingerprint.
    if (
      (deterministic.eligibilityState === "MATCH" || deterministic.eligibilityState === "REJECT") &&
      candidate.llmAnalysis?.inputFingerprint !== analysisFingerprint
    ) {
      llmAnalysis = await buildDeterministicTemplateAnalysis(candidate, analysisFingerprint, {
        fitNote:
          deterministic.eligibilityState === "MATCH"
            ? "Meets all core search criteria: price, size, and rooms within target range."
            : deterministic.reason,
        translate: deterministic.eligibilityState === "MATCH",
        previousAnalysis: candidate.llmAnalysis,
        fetchImpl
      });
    }

    const hasClassifierBudget = semanticClassifierCalls < env.GEMINI_CLASSIFIER_MAX_PER_RUN;
    const hasClassifierFallbackBudget = semanticClassifierFallbackCalls < env.GEMINI_CLASSIFIER_FALLBACK_MAX_PER_RUN;
    const isInClassifierCooldown = isClassifierCooldownActive({
      errorKind: candidate.semanticLastErrorKind,
      errorAt: candidate.semanticLastErrorAt,
      cooldownMs: env.GEMINI_CLASSIFIER_RETRY_COOLDOWN_MS,
      now: new Date()
    });
    const shouldCallSemanticClassifier =
      semanticClassifierEnabled &&
      !canReuseCachedClassification &&
      !stopSemanticClassifierForRun &&
      hasClassifierBudget &&
      !isInClassifierCooldown;

    if (shouldCallSemanticClassifier) {
      const elapsedSinceLastCallMs = Date.now() - lastSemanticClassifierCallAt;
      const waitMs =
        semanticClassifierCalls > 0
          ? Math.max(0, env.GEMINI_CLASSIFIER_MIN_DELAY_MS - elapsedSinceLastCallMs)
          : 0;

      if (waitMs > 0) {
        await sleepImpl(waitMs);
      }

      semanticClassifierCalls += 1;
      lastSemanticClassifierCallAt = Date.now();
      const timeouts = getRecommendedLlmTimeoutProfile(
        settings.runtime.llmClassifierModel,
        settings.runtime.llmAnalystModel
      );
      const fallbackTimeouts = getRecommendedLlmTimeoutProfile(
        settings.runtime.llmClassifierFallbackModel ?? settings.runtime.llmClassifierModel,
        settings.runtime.llmAnalystModel
      );
      const semantic = await classifyListingEligibility(candidate, settings, {
        deterministicScore: deterministic.score,
        deterministicReason: deterministic.reason,
        analysisFlags: deterministic.analysisFlags
      }, {
        apiKey: env.GEMINI_API_KEY,
        baseUrl: env.GEMINI_API_BASE_URL,
        // Non-Gemini provider key/URL for the classifier (Groq, Cerebras…).
        // For Gemini provider these are unused; the dispatcher routes via apiKey/baseUrl.
        classifierApiKey,
        classifierBaseUrl,
        classifierModel: settings.runtime.llmClassifierModel,
        analystModel: settings.runtime.llmAnalystModel,
        fallbackModel: settings.runtime.llmClassifierFallbackModel ?? settings.runtime.llmClassifierModel,
        fetchImpl,
        timeoutMs: timeouts.analystTimeoutMs, // unified call produces translation+summary, needs more time
        retryTimeoutMs: timeouts.analystTimeoutMs,
        fallbackTimeoutMs: fallbackTimeouts.analystTimeoutMs,
        allowClassifierFallback: !stopClassifierFallbackForRun && hasClassifierFallbackBudget
      });

      if (semantic.classifierFallbackAttempted) {
        semanticClassifierFallbackCalls += 1;
      }

      if (
        semantic.classifierFallbackErrorKind === "rate_limit" ||
        semantic.classifierFallbackErrorKind === "auth_error" ||
        semantic.classifierFallbackErrorKind === "http_error"
      ) {
        stopClassifierFallbackForRun = true;
      }

      if (!semantic.usedFallback) {
        const cacheSemanticResult = !semantic.classifierFallbackWanted || semantic.classifierFallbackAttempted;

        semanticFlags = semantic.flags;
        semanticModel = cacheSemanticResult ? semantic.model ?? settings.runtime.llmClassifierModel : null;
        semanticFitScore = semantic.fitScore ?? null;
        eligibilityState = semantic.eligibilityState;
        eligibilityReason = semantic.reason;
        semanticInputFingerprint = cacheSemanticResult ? semantic.inputFingerprint : null;
        semanticUpdatedAt = cacheSemanticResult ? new Date() : null;
        semanticLastErrorKind = null;
        semanticLastErrorAt = null;
        llmAnalysis = semantic.llmAnalysis ?? null;
      } else {
        semanticFlags = semantic.flags;
        semanticModel = null;
        semanticFitScore = semantic.fitScore ?? null;
        eligibilityState = semantic.eligibilityState;
        eligibilityReason = semantic.reason;
        semanticInputFingerprint = null;
        semanticUpdatedAt = null;
        semanticLastErrorKind = semantic.errorKind;
        semanticLastErrorAt = semantic.errorKind ? new Date() : null;

        if (
          semantic.errorSource === "primary" &&
          (semantic.errorKind === "rate_limit" || semantic.errorKind === "auth_error" || semantic.errorKind === "http_error")
        ) {
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
      semanticFitScore,
      semanticInputFingerprint,
      semanticUpdatedAt,
      semanticLastErrorKind,
      semanticLastErrorAt,
      // When LLM succeeds, persist the analysis and clear any prior LLM error.
      ...(llmAnalysis !== undefined ? {
        llmAnalysis,
        llmLastErrorKind: llmAnalysis ? null : undefined,
        llmLastErrorAt: llmAnalysis ? null : undefined
      } : {})
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

export async function runWorkerOnce({ envInput, fetchImpl = fetch, sleepImpl = sleep }: RunWorkerOptions = {}) {
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

    // Cross-portal dedup: flag newer near-identical listings, keep both rows.
    const dedupCandidates = await listDedupCandidates(db);
    const duplicateAssignments = findDuplicatePairs(dedupCandidates);
    const flaggedDuplicates = await applyDuplicateAssignments(db, duplicateAssignments);

    if (flaggedDuplicates > 0) {
      log("cross-portal duplicates flagged", { flaggedDuplicates });
    }

    const commute = await enrichListingCommutes({
      db,
      // Defensive access: unit tests stub settings with partial objects.
      office: settings.search?.officeLocation ?? null,
      fetchImpl,
      sleepImpl
    });

    if (commute.enriched > 0) {
      log("commute enrichment completed", commute);
    }

    const evaluated = await evaluateReviewQueue({
      db,
      env,
      fetchImpl,
      sleepImpl
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
