import { createHash } from "node:crypto";

import type { AnalysisFlag, EligibilityState, ListingSummary } from "./listings";
import type { AppSettings, LlmProvider } from "./settings";
import { providerDefaults } from "./settings";
import type { ContactMessage } from "./contacts";
import { contactMessageJsonSchema, contactMessageSchema } from "./contacts";
import type { LlmAnalysis, LlmErrorKind } from "./llm-analysis";
import type { ClassificationWithSummary, EnglishListingAnalyst, SemanticClassification } from "./semantic";
import {
  classificationWithSummaryJsonSchema,
  classificationWithSummarySchema,
  englishListingAnalystJsonSchema,
  englishListingAnalystSchema
} from "./semantic";
import { llmAnalysisPromptVersion, semanticClassificationPromptVersion } from "./llm-analysis";

const DEFAULT_CLASSIFIER_TIMEOUT_MS = 20_000;
const DEFAULT_ANALYST_TIMEOUT_MS = 45_000;
const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const MYMEMORY_API_URL = "https://api.mymemory.translated.net/get";
const MYMEMORY_MAX_CHARS = 500;

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

type OpenAiChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

const semanticFlagByAnalysisFlag: Partial<Record<AnalysisFlag, SemanticClassification["flags"][number]>> = {
  wbs_required: "WBS_REQUIRED",
  temporary_sublet: "SHORT_TERM",
  couple_friendly: "COUPLE_FRIENDLY",
  long_term: "LONG_TERM",
  furnished_text: "FURNISHED"
};

export type LlmRuntimeDeps = {
  /** Gemini API key — used for the analyst model and when llmProvider = "gemini". */
  apiKey?: string | null;
  /** Gemini base URL — used for the analyst model and when llmProvider = "gemini". */
  baseUrl?: string | null;
  /** API key for the non-Gemini classifier provider (Groq, Cerebras…). Ignored when llmProvider = "gemini". */
  classifierApiKey?: string | null;
  /** Base URL for the non-Gemini classifier provider. Falls back to the provider's known default when unset. */
  classifierBaseUrl?: string | null;
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
  /** LLM-generated analysis (translation + summary + fitNote). Null when LLM was unavailable. */
  llmAnalysis: LlmAnalysis | null;
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

export async function translateWithMyMemory(
  text: string,
  options: { fetchImpl?: typeof fetch } = {}
): Promise<string | null> {
  const trimmed = text.trim().slice(0, MYMEMORY_MAX_CHARS);

  if (!trimmed) {
    return null;
  }

  const fetchFn = options.fetchImpl ?? fetch;

  try {
    const params = new URLSearchParams({ q: trimmed, langpair: "de|en" });
    const res = await fetchFn(`${MYMEMORY_API_URL}?${params}`);

    if (!res.ok) {
      return null;
    }

    const data = await res.json() as { responseStatus: number; responseData?: { translatedText?: string } };

    return data.responseStatus === 200 && data.responseData?.translatedText
      ? data.responseData.translatedText
      : null;
  } catch {
    return null;
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
  // couple_friendly excluded: not a user preference, was causing false MATCHes
  return flags.filter((flag) =>
    ["long_term", "balcony_mentioned", "elevator_mentioned"].includes(flag)
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

function buildUnifiedEvaluationPrompt(
  listing: LlmListingInput,
  settings: AppSettings,
  context: ListingEligibilityContext,
  compact: boolean
) {
  const lines = [
    "You are a strict Berlin rental listing analyst and classifier.",
    "Return strict JSON matching the schema. Output ONLY valid JSON — no other text.",
    "You produce an eligibility decision AND a brief English analysis in one response.",
    "",
    "HARD REJECT RULES — each fires independently and overrides all other positives, no exceptions:",
    "- Short-term, temporary, or sublet: Zwischenmiete, Untermiete, befristet, auf Zeit, nur für X Monate, for X months, limited-period, short-term sublet → REJECT + SHORT_TERM flag.",
    "- WBS required (Wohnberechtigungsschein) → REJECT + WBS_REQUIRED flag.",
    "- Apartment swap (Wohnungstausch, Tauschwohnung) → REJECT.",
    "- Room-only or shared flat (WG-Zimmer, roommate, shared room) → REJECT.",
    "- Any item in the Avoid list below explicitly matches the listing content → REJECT.",
    "",
    "ELIGIBILITY DECISION:",
    "- MATCH: no hard reject fires AND listing clearly fits the search profile.",
    "- REJECT: any hard reject fires, OR listing clearly misses the core profile.",
    "- UNSURE: rental type ambiguous, critical details missing, or contradictory signals.",
    "",
    "WHAT TO COUNT AS POSITIVE (credit ONLY what the user asked for):",
    "- Credit only attributes from the must-match list and notes.",
    "- Do NOT treat couple-friendliness, furnishing, balcony, or elevator as positive signals unless explicitly requested.",
    "- LONG_TERM flag: set only when explicit long-term language appears (langfristig, unbefristet, long-term lease, permanent rental). Never infer from 'Wohnung' or 'apartment' alone.",
    "- SHORT_TERM flag: set whenever the listing is time-limited, temporary, a sublet, or for a short period.",
    "- No description: default to UNSURE unless the title and metadata make MATCH or REJECT evident.",
    "",
    "fitScore 0-100 (semantic fit, NOT metadata alone):",
    "- MATCH 65-100: borderline MATCH ~65, strong MATCH 85+.",
    "- UNSURE 35-64.",
    "- REJECT 0-34. Example: a 2-month furnished sublet → fitScore ≤ 10.",
    "",
    "ANALYSIS (required):",
    "- summary: 2-3 sentences of key facts about the listing in English.",
    "- fitNote: 1 sentence explaining the eligibility verdict in English.",
    "",
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
    `Core profile: max warm rent ${settings.scoring.maxWarmRent} EUR, min size ${settings.scoring.minimumSizeSqm} sqm, min rooms ${settings.scoring.minimumRooms}`,
    `Deterministic score: ${context.deterministicScore}`,
    `Pre-filter flags: ${stringifyPromptValue(context.analysisFlags)}`,
    `Must match: ${stringifyPromptValue(settings.semanticRules.mustMatch)}`,
    `Avoid: ${stringifyPromptValue(settings.semanticRules.avoid)}`,
    `Notes: ${stringifyPromptValue(settings.semanticRules.notes)}`
  ];

  if (compact) {
    return [
      "Compact retry mode. Be decisive: MATCH or REJECT when evidence is clear; UNSURE only when genuinely ambiguous. Keep translations brief.",
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

/**
 * OpenAI-compatible JSON caller (Groq, Cerebras, etc.).
 * Uses /chat/completions with response_format: json_schema for structured output.
 */
async function callOpenAiCompatibleJson<T>({
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
  baseUrl: string;
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
      "LLM classifier API key is missing. Set the provider API key (e.g. GROQ_API_KEY) for the worker process."
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.1,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "classification",
            strict: true,
            schema: responseJsonSchema
          }
        }
      })
    });

    if (!response.ok) {
      const payload = await response.text();
      const message = extractGeminiErrorMessage(payload) ?? `LLM request failed with status ${response.status}.`;
      throw new GeminiStructuredError(mapGeminiHttpErrorKind(response.status), message, response.status);
    }

    const payload = (await response.json()) as OpenAiChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content?.trim() ?? "";

    if (!content) {
      throw new GeminiStructuredError("empty_response", "LLM classifier returned an empty response.");
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(content);
    } catch {
      throw new GeminiStructuredError("invalid_json", "LLM classifier returned invalid JSON.");
    }

    try {
      return parse(parsedJson);
    } catch {
      throw new GeminiStructuredError("invalid_json", "LLM classifier returned schema-invalid JSON.");
    }
  } catch (error) {
    if (error instanceof GeminiStructuredError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new GeminiStructuredError("timeout", "LLM classifier request timed out.");
    }

    throw new GeminiStructuredError(
      "transport_error",
      error instanceof Error ? error.message : "LLM classifier request failed."
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Dispatcher: routes the classifier call to the right HTTP adapter based on llmProvider.
 * The analyst always uses callGeminiJson directly (native responseJsonSchema support).
 */
async function callClassifierLlmJson<T>(
  provider: LlmProvider,
  deps: LlmRuntimeDeps,
  args: {
    model: string;
    timeoutMs: number;
    responseJsonSchema: Record<string, unknown>;
    systemInstruction: string;
    userPrompt: string;
    parse: (value: unknown) => T;
  }
): Promise<T> {
  if (provider === "gemini") {
    return callGeminiJson({
      apiKey: deps.apiKey,
      baseUrl: deps.baseUrl,
      fetchImpl: deps.fetchImpl,
      ...args
    });
  }

  const providerBaseUrl =
    deps.classifierBaseUrl?.trim() ||
    providerDefaults[provider].baseUrl;

  return callOpenAiCompatibleJson({
    apiKey: deps.classifierApiKey,
    baseUrl: providerBaseUrl,
    fetchImpl: deps.fetchImpl,
    ...args
  });
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

type TranslationInfo = {
  sourceLanguage: string;
  translatedTitle: string | null;
  translatedDescription: string | null;
  translationModel: string | null;
};

function buildLlmAnalysisFromEvaluation(
  result: ClassificationWithSummary,
  model: string,
  inputFingerprint: string,
  translation: TranslationInfo
): LlmAnalysis {
  return {
    sourceLanguage: translation.sourceLanguage,
    translatedTitle: translation.translatedTitle,
    translatedDescription: translation.translatedDescription,
    summary: result.summary,
    fitNote: result.fitNote,
    model,
    translationModel: translation.translationModel,
    promptVersion: semanticClassificationPromptVersion,
    inputFingerprint,
    updatedAt: new Date().toISOString()
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

export async function buildDeterministicMatchAnalysis(
  listing: Pick<LlmListingInput, "title" | "description" | "district" | "rentWarm" | "sizeSqm" | "rooms" | "availableFrom">,
  inputFingerprint: string,
  deps: { fetchImpl?: typeof fetch }
): Promise<LlmAnalysis> {
  const isEnglish = listingTextLooksEnglish(listing);
  let translatedTitle: string | null = null;
  let translatedDescription: string | null = null;
  let translationModel: string | null = null;

  if (!isEnglish) {
    const [title, description] = await Promise.all([
      listing.title?.trim() ? translateWithMyMemory(listing.title, { fetchImpl: deps.fetchImpl }) : Promise.resolve(null),
      listing.description?.trim() ? translateWithMyMemory(listing.description, { fetchImpl: deps.fetchImpl }) : Promise.resolve(null)
    ]);

    if (title || description) {
      translatedTitle = title;
      translatedDescription = description;
      translationModel = "mymemory";
    }
  }

  const parts: string[] = [];
  if (listing.rooms) parts.push(`${listing.rooms}-room`);
  parts.push("apartment");
  if (listing.district) parts.push(`in ${listing.district}`);
  const details: string[] = [];
  if (listing.sizeSqm) details.push(`${listing.sizeSqm} sqm`);
  if (listing.rentWarm) details.push(`${listing.rentWarm} € warm rent`);
  if (listing.availableFrom) details.push(`available from ${listing.availableFrom}`);

  const summaryBase = parts.join(" ");
  const summary = details.length > 0 ? `${summaryBase}. ${details.join(", ")}.` : `${summaryBase}.`;

  return {
    sourceLanguage: isEnglish ? "English" : "German",
    translatedTitle,
    translatedDescription,
    summary,
    fitNote: "Meets all core search criteria: price, size, and rooms within target range.",
    model: "deterministic",
    translationModel,
    promptVersion: semanticClassificationPromptVersion,
    inputFingerprint,
    updatedAt: new Date().toISOString()
  };
}

export async function classifyListingEligibility(
  listing: LlmListingInput,
  settings: AppSettings,
  context: ListingEligibilityContext,
  deps: ListingEligibilityDeps
): Promise<EligibilityClassificationResult> {
  const inputFingerprint = buildSemanticClassificationFingerprint(listing, settings, context);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_ANALYST_TIMEOUT_MS;
  const retryTimeoutMs = deps.retryTimeoutMs ?? Math.round(timeoutMs * 1.4);
  const fallbackModel = getConfiguredClassifierFallbackModel(settings, deps);
  const fallbackTimeoutMs = deps.fallbackTimeoutMs ?? timeoutMs;
  let didRetry = false;

  const provider: LlmProvider = (settings.runtime.llmProvider as LlmProvider) ?? "gemini";

  // Pre-translate with MyMemory for display; LLM receives original text for analysis.
  const listingIsGerman = !listingTextLooksEnglish(listing);
  let translationInfo: TranslationInfo = {
    sourceLanguage: listingIsGerman ? "German" : "English",
    translatedTitle: null,
    translatedDescription: null,
    translationModel: null
  };

  if (listingIsGerman) {
    const [title, description] = await Promise.all([
      listing.title?.trim() ? translateWithMyMemory(listing.title, { fetchImpl: deps.fetchImpl }) : Promise.resolve(null),
      listing.description?.trim() ? translateWithMyMemory(listing.description, { fetchImpl: deps.fetchImpl }) : Promise.resolve(null)
    ]);

    if (title || description) {
      translationInfo = {
        sourceLanguage: "German",
        translatedTitle: title,
        translatedDescription: description,
        translationModel: "mymemory"
      };
    }
  }

  async function runEvaluation(model: string, compact: boolean, requestTimeoutMs: number): Promise<ClassificationWithSummary> {
    return callClassifierLlmJson(provider, deps, {
      model,
      timeoutMs: requestTimeoutMs,
      responseJsonSchema: classificationWithSummaryJsonSchema,
      systemInstruction: "You are a strict Berlin rental listing analyst and classifier. Output only valid JSON.",
      userPrompt: buildUnifiedEvaluationPrompt(listing, settings, context, compact),
      parse: (value) => classificationWithSummarySchema.parse(value)
    });
  }

  async function tryEvaluationFallback(): Promise<{ result: ClassificationWithSummary | null; errorKind: LlmErrorKind | null }> {
    if (!fallbackModel) {
      return { result: null, errorKind: null };
    }

    try {
      return { result: await runEvaluation(fallbackModel, false, fallbackTimeoutMs), errorKind: null };
    } catch (fallbackError) {
      return { result: null, errorKind: getLlmErrorKind(fallbackError) };
    }
  }

  function toClassification(full: ClassificationWithSummary): SemanticClassification {
    return { eligibilityState: full.eligibilityState, reason: full.reason, flags: full.flags, fitScore: full.fitScore };
  }

  async function buildSuccessfulResult(full: ClassificationWithSummary, model: string, didPrimaryRetry: boolean): Promise<EligibilityClassificationResult> {
    const result = toClassification(full);
    const classifierFallbackWanted = shouldEscalateClassifierResult(result, null, settings, context, deps);

    if (classifierFallbackWanted && deps.allowClassifierFallback !== false) {
      const fallback = await tryEvaluationFallback();

      if (fallback.result && fallbackModel) {
        return {
          ...toClassification(fallback.result),
          llmAnalysis: buildLlmAnalysisFromEvaluation(fallback.result, fallbackModel, inputFingerprint, translationInfo),
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
        llmAnalysis: buildLlmAnalysisFromEvaluation(full, model, inputFingerprint, translationInfo),
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
      llmAnalysis: buildLlmAnalysisFromEvaluation(full, model, inputFingerprint, translationInfo),
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

  async function buildUnavailableResult(primaryErrorKind: LlmErrorKind): Promise<EligibilityClassificationResult> {
    const classifierFallbackWanted = shouldEscalateClassifierResult(null, primaryErrorKind, settings, context, deps);

    if (classifierFallbackWanted && deps.allowClassifierFallback !== false) {
      const fallback = await tryEvaluationFallback();

      if (fallback.result && fallbackModel) {
        return {
          ...toClassification(fallback.result),
          llmAnalysis: buildLlmAnalysisFromEvaluation(fallback.result, fallbackModel, inputFingerprint, translationInfo),
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
        llmAnalysis: null,
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
      llmAnalysis: null,
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
    const result = await runEvaluation(deps.classifierModel, false, timeoutMs);

    return buildSuccessfulResult(result, deps.classifierModel, false);
  } catch (error) {
    if (shouldRetryClassifier(error)) {
      didRetry = true;

      try {
        const result = await runEvaluation(deps.classifierModel, true, retryTimeoutMs);

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

function buildApplicationMessagePrompt(listing: LlmListingInput, settings: AppSettings) {
  const profile = settings.profile;

  return [
    "You write rental application messages for a Berlin apartment hunt.",
    "Write in German with a formal, polite tone (Sie form). Plain text only, no markdown.",
    "The body must be roughly 120-180 words: brief intro of the applicant, why this specific listing fits, availability for a viewing, and a polite closing with the applicant's name.",
    "Mention concrete listing details (district, rooms, size) naturally — never invent facts that are not in the data below.",
    "Do not mention scores, dashboards, or that this message was generated.",
    "Return strict JSON matching the schema.",
    `Applicant name: ${stringifyPromptValue(profile.fullName)}`,
    `Applicant bio: ${stringifyPromptValue(profile.shortBio)}`,
    `Applicant email: ${stringifyPromptValue(profile.email)}`,
    `Applicant phone: ${stringifyPromptValue(profile.phone)}`,
    `Listing title: ${truncatePromptText(listing.title, PROMPT_TITLE_MAX_CHARS)}`,
    `Listing description: ${truncatePromptText(listing.description, PROMPT_DESCRIPTION_MAX_CHARS)}`,
    `District: ${stringifyPromptValue(listing.district)}`,
    `Address: ${stringifyPromptValue(listing.addressLine)}`,
    `Warm rent: ${stringifyPromptValue(listing.rentWarm ?? listing.rentCold)}`,
    `Rooms: ${stringifyPromptValue(listing.rooms)}`,
    `Size sqm: ${stringifyPromptValue(listing.sizeSqm)}`,
    `Available from: ${stringifyPromptValue(listing.availableFrom)}`,
    `Listing summary (English): ${stringifyPromptValue(listing.llmAnalysis?.summary ?? null)}`,
    `Fit note (English): ${stringifyPromptValue(listing.llmAnalysis?.fitNote ?? null)}`,
    `Applicant search notes: ${stringifyPromptValue(settings.semanticRules.notes)}`
  ].join("\n");
}

/**
 * On-demand draft of a German application message for one listing.
 * Always uses the Gemini analyst model — outside the classifier budget machinery.
 */
export async function generateApplicationMessage(
  listing: LlmListingInput,
  settings: AppSettings,
  deps: EnglishAnalystDeps
): Promise<ContactMessage> {
  return callGeminiJson({
    apiKey: deps.apiKey,
    baseUrl: deps.baseUrl,
    model: deps.analystModel,
    fetchImpl: deps.fetchImpl,
    timeoutMs: deps.analystTimeoutMs ?? DEFAULT_ANALYST_TIMEOUT_MS,
    responseJsonSchema: contactMessageJsonSchema as unknown as Record<string, unknown>,
    systemInstruction: "You are a precise assistant that writes German rental application messages. Output only valid JSON.",
    userPrompt: buildApplicationMessagePrompt(listing, settings),
    parse: (value) => contactMessageSchema.parse(value)
  });
}
