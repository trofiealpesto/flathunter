import { createHash } from "node:crypto";

import type { AnalysisFlag, EligibilityState, ListingSummary } from "./listings";
import type { AppSettings } from "./settings";
import type { LlmAnalysis, LlmErrorKind } from "./llm-analysis";
import type { EnglishListingAnalyst, SemanticClassification } from "./semantic";
import {
  englishListingAnalystJsonSchema,
  englishListingAnalystSchema,
  semanticClassificationJsonSchema,
  semanticClassificationSchema
} from "./semantic";
import { llmAnalysisPromptVersion, semanticClassificationPromptVersion } from "./llm-analysis";

const DEFAULT_CLASSIFIER_TIMEOUT_MS = 20_000;
const DEFAULT_ANALYST_TIMEOUT_MS = 45_000;
const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

const germanMarkers = /\b(wohnung|zimmer|miete|warmmiete|kaltmiete|befristet|zwischenmiete|möbliert|mobliert|balkon|aufzug)\b|[äöüß]/i;
const englishMarkers = /\b(apartment|flat|room|rent|balcony|elevator|available|kitchen|furnished|long[- ]term)\b/i;
const PROMPT_TITLE_MAX_CHARS = 180;
const PROMPT_DESCRIPTION_MAX_CHARS = 2_400;
const CLASSIFIER_FALLBACK_MATCH_SCORE = 86;
const CLASSIFIER_FALLBACK_REJECT_SCORE = 35;

type LlmListingInput = Pick<
  ListingSummary,
  | "id"
  | "portal"
  | "portalListingId"
  | "url"
  | "canonicalUrl"
  | "title"
  | "description"
  | "addressLine"
  | "city"
  | "district"
  | "neighborhood"
  | "latitude"
  | "longitude"
  | "geoSource"
  | "distanceKm"
  | "rentCold"
  | "rentWarm"
  | "sizeSqm"
  | "rooms"
  | "floor"
  | "availableFrom"
  | "isFurnished"
  | "hasBalcony"
  | "hasElevator"
  | "score"
  | "userStatus"
  | "eligibilityState"
  | "eligibilityReason"
  | "sourceMode"
  | "analysisFlags"
  | "semanticFlags"
  | "semanticModel"
  | "llmAnalysis"
  | "firstSeenAt"
  | "lastSeenAt"
  | "createdAt"
  | "updatedAt"
>;

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
};

const semanticFlagByAnalysisFlag: Partial<Record<AnalysisFlag, SemanticClassification["flags"][number]>> = {
  wbs_required: "WBS_REQUIRED",
  temporary_sublet: "SHORT_TERM",
  couple_friendly: "COUPLE_FRIENDLY",
  long_term: "LONG_TERM",
  furnished_text: "FURNISHED"
};

export type LlmRuntimeDeps = {
  apiKey?: string | null;
  baseUrl?: string | null;
  classifierModel: string;
  analystModel: string;
  fetchImpl: typeof fetch;
};

export type ListingEligibilityContext = {
  deterministicScore: number;
  deterministicReason: string;
  analysisFlags: AnalysisFlag[];
};

export type ListingEligibilityDeps = LlmRuntimeDeps & {
  timeoutMs?: number;
  retryTimeoutMs?: number;
  allowClassifierFallback?: boolean;
  fallbackModel?: string | null;
  fallbackTimeoutMs?: number;
};

export type EnglishAnalystDeps = LlmRuntimeDeps & {
  analystTimeoutMs?: number;
};

export type EligibilityClassificationResult = SemanticClassification & {
  inputFingerprint: string;
  model: string | null;
  usedFallback: boolean;
  errorKind: LlmErrorKind | null;
  errorSource: "primary" | "fallback" | null;
  didRetry: boolean;
  classifierFallbackWanted: boolean;
  classifierFallbackAttempted: boolean;
  classifierFallbackSucceeded: boolean;
  classifierFallbackErrorKind: LlmErrorKind | null;
};

export type EnglishAnalystGenerationResult = {
  analysis: EnglishListingAnalyst;
  llmAnalysis: LlmAnalysis;
  inputFingerprint: string;
  translationSkipped: boolean;
};

export type LlmTimeoutProfile = {
  classificationTimeoutMs: number;
  classificationRetryTimeoutMs: number;
  analystTimeoutMs: number;
};

class GeminiStructuredError extends Error {
  kind: LlmErrorKind;
  status: number | null;

  constructor(kind: LlmErrorKind, message: string, status: number | null = null) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.name = "GeminiStructuredError";
  }
}

function normalizeBaseUrl(baseUrl?: string | null) {
  return (baseUrl?.trim() || DEFAULT_GEMINI_BASE_URL).replace(/\/+$/, "");
}

function stringifyPromptValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(", ") : "none";
  }

  if (value == null || value === "") {
    return "none";
  }

  return String(value);
}

function normalizeDistrict(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function isPreferredDistrict(listing: LlmListingInput, settings: AppSettings) {
  const district = normalizeDistrict(listing.district);

  if (!district) {
    return false;
  }

  return settings.scoring.preferredDistricts.some((preferred) => normalizeDistrict(preferred) === district);
}

function countPositiveAnalysisSignals(flags: AnalysisFlag[]) {
  return flags.filter((flag) =>
    ["long_term", "couple_friendly", "balcony_mentioned", "elevator_mentioned"].includes(flag)
  ).length;
}

function listingMeetsCoreProfile(listing: LlmListingInput, settings: AppSettings) {
  const rent = listing.rentWarm ?? listing.rentCold;

  return (
    rent != null &&
    rent <= settings.scoring.maxWarmRent &&
    listing.sizeSqm != null &&
    listing.sizeSqm >= settings.scoring.minimumSizeSqm &&
    listing.rooms != null &&
    listing.rooms >= settings.scoring.minimumRooms
  );
}

function listingClearlyMissesCoreProfile(listing: LlmListingInput, settings: AppSettings) {
  const rent = listing.rentWarm ?? listing.rentCold;

  return (
    (rent != null && rent > settings.scoring.maxWarmRent * 1.2) ||
    (listing.sizeSqm != null && listing.sizeSqm < settings.scoring.minimumSizeSqm * 0.75) ||
    (listing.rooms != null && listing.rooms < settings.scoring.minimumRooms - 0.75)
  );
}

function mapAnalysisFlagsToSemanticFlags(flags: AnalysisFlag[]): SemanticClassification["flags"] {
  return [
    ...new Set(
      flags
        .map((flag) => semanticFlagByAnalysisFlag[flag])
        .filter((flag): flag is SemanticClassification["flags"][number] => Boolean(flag))
    )
  ];
}

function describeClassifierError(errorKind: LlmErrorKind | null) {
  if (!errorKind) {
    return "unavailable";
  }

  return errorKind.replace(/_/g, " ");
}

function truncatePromptText(value: string | null | undefined, maxChars: number) {
  if (!value) {
    return "";
  }

  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function getSingleModelTimeoutProfile(model: string): LlmTimeoutProfile {
  const normalized = model.trim().toLowerCase();

  if (normalized.includes("flash-lite")) {
    return {
      classificationTimeoutMs: 18_000,
      classificationRetryTimeoutMs: 28_000,
      analystTimeoutMs: 35_000
    };
  }

  if (normalized.includes("flash")) {
    return {
      classificationTimeoutMs: 24_000,
      classificationRetryTimeoutMs: 36_000,
      analystTimeoutMs: 55_000
    };
  }

  if (normalized.includes("pro")) {
    return {
      classificationTimeoutMs: 30_000,
      classificationRetryTimeoutMs: 45_000,
      analystTimeoutMs: 75_000
    };
  }

  return {
    classificationTimeoutMs: DEFAULT_CLASSIFIER_TIMEOUT_MS,
    classificationRetryTimeoutMs: Math.round(DEFAULT_CLASSIFIER_TIMEOUT_MS * 1.4),
    analystTimeoutMs: DEFAULT_ANALYST_TIMEOUT_MS
  };
}

export function getRecommendedLlmTimeoutProfile(classifierModel: string, analystModel?: string | null): LlmTimeoutProfile {
  const classifierProfile = getSingleModelTimeoutProfile(classifierModel);
  const analystProfile = getSingleModelTimeoutProfile(analystModel ?? classifierModel);

  return {
    classificationTimeoutMs: classifierProfile.classificationTimeoutMs,
    classificationRetryTimeoutMs: classifierProfile.classificationRetryTimeoutMs,
    analystTimeoutMs: Math.max(classifierProfile.analystTimeoutMs, analystProfile.analystTimeoutMs)
  };
}

function buildClassifierPrompt(
  listing: LlmListingInput,
  settings: AppSettings,
  context: ListingEligibilityContext,
  compact: boolean
) {
  const lines = [
    "Classify a Berlin rental listing for a private apartment search dashboard.",
    "Return strict JSON and do not include commentary outside JSON.",
    "Decision policy:",
    "- MATCH when the listing clearly fits the search profile and does not conflict with avoid rules.",
    "- REJECT when the listing clearly conflicts with avoid rules or is obviously a poor fit.",
    "- UNSURE when the text is ambiguous, contradictory, missing critical detail, or only has weak title/metadata evidence.",
    "Evidence policy:",
    "- Treat rent, rooms, size, district, and deterministic score as supporting evidence, not proof of semantic fit.",
    "- Do not infer long-term rental, private-apartment fit, or couple suitability from metadata alone.",
    "- If the description is empty and the deterministic score is below 80, keep UNSURE unless the title explicitly proves the rental type and no avoid-rule conflict.",
    "- If the description is empty and the deterministic score is 80 or higher, MATCH is allowed only when the title explicitly indicates an apartment/flat/Wohnung and the core profile fields fit.",
    "- Set LONG_TERM only when title or description explicitly indicates a normal long-term rental, indefinite lease, or no short-term/sublet constraint.",
    "- Do not set LONG_TERM from words like apartment, flat, Wohnung, rent, rooms, price, or district alone.",
    "- For UNSURE, use an empty flags array unless a flag is explicitly stated in the title or description.",
    `Title: ${truncatePromptText(listing.title, PROMPT_TITLE_MAX_CHARS)}`,
    `Description: ${truncatePromptText(listing.description, PROMPT_DESCRIPTION_MAX_CHARS)}`,
    `Description present: ${listing.description?.trim() ? "yes" : "no"}`,
    `District: ${stringifyPromptValue(listing.district)}`,
    `City: ${stringifyPromptValue(listing.city)}`,
    `Search districts: ${stringifyPromptValue(settings.search.districts)}`,
    `Preferred scoring districts: ${stringifyPromptValue(settings.scoring.preferredDistricts)}`,
    `Address: ${stringifyPromptValue(listing.addressLine)}`,
    `Warm rent: ${stringifyPromptValue(listing.rentWarm ?? listing.rentCold)}`,
    `Rooms: ${stringifyPromptValue(listing.rooms)}`,
    `Size sqm: ${stringifyPromptValue(listing.sizeSqm)}`,
    `Available from: ${stringifyPromptValue(listing.availableFrom)}`,
    `Core scoring profile: max warm rent ${settings.scoring.maxWarmRent}, minimum size ${settings.scoring.minimumSizeSqm} sqm, minimum rooms ${settings.scoring.minimumRooms}`,
    `Deterministic score: ${context.deterministicScore}`,
    `Deterministic reason: ${context.deterministicReason}`,
    `Deterministic analysis flags: ${stringifyPromptValue(context.analysisFlags)}`,
    `Must match: ${stringifyPromptValue(settings.semanticRules.mustMatch)}`,
    `Avoid: ${stringifyPromptValue(settings.semanticRules.avoid)}`,
    `Notes: ${stringifyPromptValue(settings.semanticRules.notes)}`,
    "fitScore policy:",
    "- Return fitScore 0-100: how well this listing fits the search profile and rules.",
    "- Base fitScore on semantic content (description, title, rental type, terms) — not metadata alone.",
    "- 100 = ideal fit for all must-match rules and preferences. 0 = clear reject or completely wrong type.",
    "- MATCH range: 65-100. UNSURE range: 35-64. REJECT range: 0-34.",
    "- Calibrate within each eligibility bucket: a borderline MATCH scores ~65, a strong MATCH scores 85+."
  ];

  if (compact) {
    return [
      "Compact retry mode. Prefer MATCH or REJECT only when evidence is adequate; keep title-only or metadata-only listings UNSURE.",
      ...lines
    ].join("\n");
  }

  return lines.join("\n");
}

function buildAnalystPrompt(listing: LlmListingInput, settings: AppSettings) {
  return [
    "You analyze Berlin rental listings for a private apartment hunting dashboard.",
    "Return strict JSON that matches the schema.",
    "Always detect the source language.",
    "Translate the title and description into concise factual English when needed. If the listing is already English, reuse or lightly normalize the source text.",
    "Write summary and fitNote in concise English.",
    "Use MATCH when the fit is clear, REJECT when the listing clearly conflicts with the search, and UNSURE only when the listing is genuinely ambiguous or contradictory.",
    `Original title: ${truncatePromptText(listing.title, PROMPT_TITLE_MAX_CHARS)}`,
    `Original description: ${truncatePromptText(listing.description, PROMPT_DESCRIPTION_MAX_CHARS)}`,
    `District: ${stringifyPromptValue(listing.district)}`,
    `Address: ${stringifyPromptValue(listing.addressLine)}`,
    `Warm rent: ${stringifyPromptValue(listing.rentWarm ?? listing.rentCold)}`,
    `Rooms: ${stringifyPromptValue(listing.rooms)}`,
    `Size sqm: ${stringifyPromptValue(listing.sizeSqm)}`,
    `Current score: ${stringifyPromptValue(listing.score)}`,
    `Deterministic analysis flags: ${stringifyPromptValue(listing.analysisFlags)}`,
    `Current semantic flags: ${stringifyPromptValue(listing.semanticFlags)}`,
    `Must match: ${stringifyPromptValue(settings.semanticRules.mustMatch)}`,
    `Avoid: ${stringifyPromptValue(settings.semanticRules.avoid)}`,
    `Notes: ${stringifyPromptValue(settings.semanticRules.notes)}`
  ].join("\n");
}

function listingTextLooksEnglish(listing: Pick<LlmListingInput, "title" | "description">) {
  const text = `${listing.title}\n${listing.description ?? ""}`.trim();

  if (!text) {
    return true;
  }

  if (germanMarkers.test(text) && !englishMarkers.test(text)) {
    return false;
  }

  return englishMarkers.test(text);
}

function mapGeminiHttpErrorKind(status: number): LlmErrorKind {
  if (status === 401 || status === 403) {
    return "auth_error";
  }

  if (status === 429) {
    return "rate_limit";
  }

  return "http_error";
}

function extractGeminiErrorMessage(payload: string) {
  if (!payload.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(payload) as {
      error?: {
        message?: unknown;
      };
    };

    if (typeof parsed.error?.message === "string" && parsed.error.message.trim().length > 0) {
      return parsed.error.message.trim();
    }
  } catch {
    return payload.trim();
  }

  return payload.trim();
}

function extractCandidateText(payload: GeminiGenerateContentResponse) {
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((part) => part.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();

  if (text.length > 0) {
    return text;
  }

  if (payload.promptFeedback?.blockReason) {
    throw new GeminiStructuredError(
      "empty_response",
      `Gemini blocked the request: ${payload.promptFeedback.blockReason}.`
    );
  }

  throw new GeminiStructuredError("empty_response", "Gemini returned an empty response.");
}

async function callGeminiJson<T>({
  apiKey,
  baseUrl,
  model,
  fetchImpl,
  timeoutMs,
  responseJsonSchema,
  systemInstruction,
  userPrompt,
  parse
}: {
  apiKey?: string | null;
  baseUrl?: string | null;
  model: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  responseJsonSchema: Record<string, unknown>;
  systemInstruction: string;
  userPrompt: string;
  parse: (value: unknown) => T;
}) {
  if (!apiKey?.trim()) {
    throw new GeminiStructuredError(
      "auth_error",
      "Gemini API key is missing. Set GEMINI_API_KEY for the API and worker processes."
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  try {
    const response = await fetchImpl(`${normalizedBaseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: systemInstruction
            }
          ]
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: userPrompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          responseJsonSchema
        }
      })
    });

    if (!response.ok) {
      const payload = await response.text();
      const message = extractGeminiErrorMessage(payload) ?? `Gemini request failed with status ${response.status}.`;
      throw new GeminiStructuredError(mapGeminiHttpErrorKind(response.status), message, response.status);
    }

    const payload = (await response.json()) as GeminiGenerateContentResponse;
    const content = extractCandidateText(payload);

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(content);
    } catch {
      throw new GeminiStructuredError("invalid_json", "Gemini returned invalid JSON.");
    }

    try {
      return parse(parsedJson);
    } catch {
      throw new GeminiStructuredError("invalid_json", "Gemini returned schema-invalid JSON.");
    }
  } catch (error) {
    if (error instanceof GeminiStructuredError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new GeminiStructuredError("timeout", "Gemini request timed out.");
    }

    throw new GeminiStructuredError(
      "transport_error",
      error instanceof Error ? error.message : "Gemini request failed."
    );
  } finally {
    clearTimeout(timeout);
  }
}

function shouldRetryClassifier(error: unknown) {
  if (!(error instanceof GeminiStructuredError)) {
    return false;
  }

  if (error.kind === "timeout" || error.kind === "invalid_json") {
    return true;
  }

  return error.kind === "http_error" && error.status != null && error.status >= 500;
}

function isRecoverableForClassifierFallback(errorKind: LlmErrorKind | null) {
  return (
    errorKind === "invalid_json" ||
    errorKind === "empty_response" ||
    errorKind === "timeout" ||
    errorKind === "transport_error" ||
    errorKind === "http_error"  // includes 404 from a misconfigured/unknown model name
  );
}

function getConfiguredClassifierFallbackModel(settings: AppSettings, deps: ListingEligibilityDeps) {
  const fallbackModel = (deps.fallbackModel ?? settings.runtime.llmClassifierFallbackModel)?.trim();

  if (!fallbackModel || fallbackModel === deps.classifierModel) {
    return null;
  }

  return fallbackModel;
}

function shouldEscalateClassifierResult(
  result: SemanticClassification | null,
  errorKind: LlmErrorKind | null,
  settings: AppSettings,
  context: ListingEligibilityContext,
  deps: ListingEligibilityDeps
) {
  if (!settings.runtime.llmClassifierFallbackEnabled || !getConfiguredClassifierFallbackModel(settings, deps)) {
    return false;
  }

  if (result) {
    // Primary succeeded but returned UNSURE: only escalate if score meets threshold (cost gate)
    if (context.deterministicScore < settings.runtime.llmClassifierFallbackMinScore) {
      return false;
    }

    return result.eligibilityState === "UNSURE";
  }

  // http_error (e.g. 404 for a misconfigured/non-existent model): always escalate to fallback
  // regardless of score — the primary model itself is broken, not the listing.
  if (errorKind === "http_error") {
    return true;
  }

  // Other recoverable errors (timeout, parse failure): still respect the score gate
  // so we don't burn fallback quota on low-value listings during transient issues.
  if (context.deterministicScore < settings.runtime.llmClassifierFallbackMinScore) {
    return false;
  }

  return isRecoverableForClassifierFallback(errorKind);
}

function buildClassifierUnavailableFallback(
  listing: LlmListingInput,
  settings: AppSettings,
  context: ListingEligibilityContext,
  errorKind: LlmErrorKind | null
): SemanticClassification {
  const semanticFlags = mapAnalysisFlagsToSemanticFlags(context.analysisFlags);
  const prefix = `Semantic classifier ${describeClassifierError(errorKind)};`;
  let eligibilityState: EligibilityState = "UNSURE";
  let reason = `${prefix} ${context.deterministicReason}`;

  if (
    context.deterministicScore >= CLASSIFIER_FALLBACK_MATCH_SCORE &&
    (listingMeetsCoreProfile(listing, settings) || isPreferredDistrict(listing, settings) || countPositiveAnalysisSignals(context.analysisFlags) > 0)
  ) {
    eligibilityState = "MATCH";
    reason = `${prefix} deterministic fallback match: score ${context.deterministicScore}.`;
  } else if (
    context.deterministicScore <= CLASSIFIER_FALLBACK_REJECT_SCORE ||
    listingClearlyMissesCoreProfile(listing, settings)
  ) {
    eligibilityState = "REJECT";
    reason = `${prefix} deterministic fallback reject: score ${context.deterministicScore}.`;
  }

  return {
    eligibilityState,
    reason,
    flags: semanticFlags,
    fitScore: context.deterministicScore
  };
}

export function getLlmErrorKind(error: unknown): LlmErrorKind {
  if (error instanceof GeminiStructuredError) {
    return error.kind;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return "timeout";
  }

  return "transport_error";
}

export function buildSemanticClassificationFingerprint(
  listing: LlmListingInput,
  settings: AppSettings,
  context: ListingEligibilityContext
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        title: listing.title,
        description: listing.description,
        district: listing.district,
        addressLine: listing.addressLine,
        rentWarm: listing.rentWarm,
        rentCold: listing.rentCold,
        rooms: listing.rooms,
        sizeSqm: listing.sizeSqm,
        availableFrom: listing.availableFrom,
        deterministicScore: context.deterministicScore,
        deterministicReason: context.deterministicReason,
        analysisFlags: context.analysisFlags,
        searchDistricts: settings.search.districts,
        preferredDistricts: settings.scoring.preferredDistricts,
        maxWarmRent: settings.scoring.maxWarmRent,
        minimumSizeSqm: settings.scoring.minimumSizeSqm,
        minimumRooms: settings.scoring.minimumRooms,
        semanticRules: settings.semanticRules,
        llmProvider: settings.runtime.llmProvider,
        classifierModel: settings.runtime.llmClassifierModel,
        classifierFallbackEnabled: settings.runtime.llmClassifierFallbackEnabled,
        classifierFallbackModel: settings.runtime.llmClassifierFallbackModel,
        classifierFallbackMinScore: settings.runtime.llmClassifierFallbackMinScore,
        promptVersion: semanticClassificationPromptVersion
      })
    )
    .digest("hex");
}

export function buildEnglishAnalystFingerprint(listing: LlmListingInput, settings: AppSettings) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        title: listing.title,
        description: listing.description,
        district: listing.district,
        addressLine: listing.addressLine,
        rentWarm: listing.rentWarm,
        rentCold: listing.rentCold,
        rooms: listing.rooms,
        sizeSqm: listing.sizeSqm,
        availableFrom: listing.availableFrom,
        score: listing.score,
        analysisFlags: listing.analysisFlags,
        semanticFlags: listing.semanticFlags,
        semanticRules: settings.semanticRules,
        llmProvider: settings.runtime.llmProvider,
        analystModel: settings.runtime.llmAnalystModel,
        promptVersion: llmAnalysisPromptVersion
      })
    )
    .digest("hex");
}

export async function classifyListingEligibility(
  listing: LlmListingInput,
  settings: AppSettings,
  context: ListingEligibilityContext,
  deps: ListingEligibilityDeps
): Promise<EligibilityClassificationResult> {
  const inputFingerprint = buildSemanticClassificationFingerprint(listing, settings, context);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_CLASSIFIER_TIMEOUT_MS;
  const retryTimeoutMs = deps.retryTimeoutMs ?? Math.round(timeoutMs * 1.4);
  const fallbackModel = getConfiguredClassifierFallbackModel(settings, deps);
  const fallbackTimeoutMs = deps.fallbackTimeoutMs ?? timeoutMs;
  let didRetry = false;

  async function runClassifier(model: string, compact: boolean, requestTimeoutMs: number) {
    return callGeminiJson({
      apiKey: deps.apiKey,
      baseUrl: deps.baseUrl,
      model,
      fetchImpl: deps.fetchImpl,
      timeoutMs: requestTimeoutMs,
      responseJsonSchema: semanticClassificationJsonSchema,
      systemInstruction: "You are a strict Berlin rental listing classifier. Output only valid JSON.",
      userPrompt: buildClassifierPrompt(listing, settings, context, compact),
      parse: (value) => semanticClassificationSchema.parse(value)
    });
  }

  async function tryClassifierFallback() {
    if (!fallbackModel) {
      return {
        result: null as SemanticClassification | null,
        errorKind: null as LlmErrorKind | null
      };
    }

    try {
      return {
        result: await runClassifier(fallbackModel, false, fallbackTimeoutMs),
        errorKind: null
      };
    } catch (fallbackError) {
      return {
        result: null,
        errorKind: getLlmErrorKind(fallbackError)
      };
    }
  }

  async function buildSuccessfulResult(result: SemanticClassification, model: string, didPrimaryRetry: boolean) {
    const classifierFallbackWanted = shouldEscalateClassifierResult(result, null, settings, context, deps);

    if (classifierFallbackWanted && deps.allowClassifierFallback !== false) {
      const fallback = await tryClassifierFallback();

      if (fallback.result && fallbackModel) {
        return {
          ...fallback.result,
          inputFingerprint,
          model: fallbackModel,
          usedFallback: false,
          errorKind: null,
          errorSource: null,
          didRetry: didPrimaryRetry,
          classifierFallbackWanted,
          classifierFallbackAttempted: true,
          classifierFallbackSucceeded: true,
          classifierFallbackErrorKind: null
        };
      }

      return {
        ...result,
        inputFingerprint,
        model,
        usedFallback: false,
        errorKind: null,
        errorSource: null,
        didRetry: didPrimaryRetry,
        classifierFallbackWanted,
        classifierFallbackAttempted: true,
        classifierFallbackSucceeded: false,
        classifierFallbackErrorKind: fallback.errorKind
      };
    }

    return {
      ...result,
      inputFingerprint,
      model,
      usedFallback: false,
      errorKind: null,
      errorSource: null,
      didRetry: didPrimaryRetry,
      classifierFallbackWanted,
      classifierFallbackAttempted: false,
      classifierFallbackSucceeded: false,
      classifierFallbackErrorKind: null
    };
  }

  async function buildUnavailableResult(primaryErrorKind: LlmErrorKind) {
    const classifierFallbackWanted = shouldEscalateClassifierResult(null, primaryErrorKind, settings, context, deps);

    if (classifierFallbackWanted && deps.allowClassifierFallback !== false) {
      const fallback = await tryClassifierFallback();

      if (fallback.result && fallbackModel) {
        return {
          ...fallback.result,
          inputFingerprint,
          model: fallbackModel,
          usedFallback: false,
          errorKind: null,
          errorSource: null,
          didRetry,
          classifierFallbackWanted,
          classifierFallbackAttempted: true,
          classifierFallbackSucceeded: true,
          classifierFallbackErrorKind: null
        };
      }

      const errorKind = fallback.errorKind ?? primaryErrorKind;
      const deterministicFallback = buildClassifierUnavailableFallback(listing, settings, context, errorKind);

      return {
        ...deterministicFallback,
        inputFingerprint,
        model: null,
        usedFallback: true,
        errorKind,
        errorSource: fallback.errorKind ? "fallback" as const : "primary" as const,
        didRetry,
        classifierFallbackWanted,
        classifierFallbackAttempted: true,
        classifierFallbackSucceeded: false,
        classifierFallbackErrorKind: fallback.errorKind
      };
    }

    const fallback = buildClassifierUnavailableFallback(listing, settings, context, primaryErrorKind);

    return {
      ...fallback,
      inputFingerprint,
      model: null,
      usedFallback: true,
      errorKind: primaryErrorKind,
      errorSource: "primary" as const,
      didRetry,
      classifierFallbackWanted,
      classifierFallbackAttempted: false,
      classifierFallbackSucceeded: false,
      classifierFallbackErrorKind: null
    };
  }

  try {
    const result = await runClassifier(deps.classifierModel, false, timeoutMs);

    return buildSuccessfulResult(result, deps.classifierModel, false);
  } catch (error) {
    if (shouldRetryClassifier(error)) {
      didRetry = true;

      try {
        const result = await runClassifier(deps.classifierModel, true, retryTimeoutMs);

        return buildSuccessfulResult(result, deps.classifierModel, didRetry);
      } catch (retryError) {
        return buildUnavailableResult(getLlmErrorKind(retryError));
      }
    }

    return buildUnavailableResult(getLlmErrorKind(error));
  }
}

export async function generateListingEnglishAnalyst(
  listing: LlmListingInput,
  settings: AppSettings,
  deps: EnglishAnalystDeps
): Promise<EnglishAnalystGenerationResult> {
  const inputFingerprint = buildEnglishAnalystFingerprint(listing, settings);
  const analysis = await callGeminiJson({
    apiKey: deps.apiKey,
    baseUrl: deps.baseUrl,
    model: deps.analystModel,
    fetchImpl: deps.fetchImpl,
    timeoutMs: deps.analystTimeoutMs ?? DEFAULT_ANALYST_TIMEOUT_MS,
    responseJsonSchema: englishListingAnalystJsonSchema,
    systemInstruction: "You are a strict housing-listing analyst. Output only valid JSON.",
    userPrompt: buildAnalystPrompt(listing, settings),
    parse: (value) => englishListingAnalystSchema.parse(value)
  });
  const translationSkipped = listingTextLooksEnglish(listing) && analysis.sourceLanguage.toLowerCase().startsWith("en");

  return {
    analysis,
    inputFingerprint,
    translationSkipped,
    llmAnalysis: {
      sourceLanguage: analysis.sourceLanguage,
      translatedTitle: analysis.translatedTitle,
      translatedDescription: analysis.translatedDescription,
      summary: analysis.summary,
      fitNote: analysis.fitNote,
      model: deps.analystModel,
      translationModel: null,
      promptVersion: llmAnalysisPromptVersion,
      inputFingerprint,
      updatedAt: new Date().toISOString()
    }
  };
}
