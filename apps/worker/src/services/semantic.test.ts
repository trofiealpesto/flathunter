import { describe, expect, it, vi } from "vitest";

import {
  buildEnglishAnalystFingerprint,
  buildSemanticClassificationFingerprint,
  classifyListingEligibility,
  defaultAppSettings,
  generateListingEnglishAnalyst,
  type ListingSummary
} from "@flathunter/shared";

const listing: ListingSummary = {
  id: 1,
  portal: "IMMOWELT",
  portalListingId: "1",
  url: "https://example.com/1",
  canonicalUrl: "https://example.com/1",
  title: "3 room apartment",
  description: "Long-term rental in Berlin with balcony and elevator.",
  addressLine: null,
  city: "Berlin",
  district: "Mitte",
  neighborhood: null,
  latitude: null,
  longitude: null,
  geoSource: null,
  distanceKm: null,
  rentCold: 1400,
  rentWarm: 1650,
  sizeSqm: 72,
  rooms: 3,
  floor: null,
  availableFrom: null,
  isFurnished: false,
  hasBalcony: true,
  hasElevator: true,
  score: 82,
  commuteMinutes: null,
  commuteSource: null,
  userStatus: "NEW",
  eligibilityState: "UNSURE",
  eligibilityReason: null,
  sourceMode: null,
  analysisFlags: ["long_term", "balcony_mentioned", "elevator_mentioned"],
  semanticFlags: [],
  semanticModel: null,
  llmAnalysis: null,
  llmAnalysisStatus: "missing",
  firstSeenAt: new Date().toISOString(),
  lastSeenAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

function buildGeminiResponse(payload: unknown) {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify(payload)
              }
            ]
          }
        }
      ]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function buildUnifiedPayload(
  eligibilityState: "MATCH" | "UNSURE" | "REJECT",
  reason: string,
  flags: string[] = [],
  fitScore?: number
) {
  return {
    eligibilityState,
    reason,
    flags,
    fitScore: fitScore ?? (eligibilityState === "MATCH" ? 80 : eligibilityState === "REJECT" ? 15 : 50),
    summary: `Test summary for ${eligibilityState} listing.`,
    fitNote: reason
  };
}

describe("classifyListingEligibility", () => {
  it("includes classifier fallback settings in the semantic fingerprint", () => {
    const context = {
      deterministicScore: 82,
      deterministicReason: "Deterministic review needed: score 82; no strong text signals.",
      analysisFlags: []
    };
    const baseline = buildSemanticClassificationFingerprint(listing, defaultAppSettings, context);

    expect(
      buildSemanticClassificationFingerprint(
        listing,
        {
          ...defaultAppSettings,
          runtime: {
            ...defaultAppSettings.runtime,
            llmClassifierFallbackModel: "gemini-2.5-pro"
          }
        },
        context
      )
    ).not.toBe(baseline);
    expect(
      buildSemanticClassificationFingerprint(
        listing,
        {
          ...defaultAppSettings,
          runtime: {
            ...defaultAppSettings.runtime,
            llmClassifierFallbackEnabled: false
          }
        },
        context
      )
    ).not.toBe(baseline);
    expect(
      buildSemanticClassificationFingerprint(
        listing,
        {
          ...defaultAppSettings,
          runtime: {
            ...defaultAppSettings.runtime,
            llmClassifierFallbackMinScore: 90
          }
        },
        context
      )
    ).not.toBe(baseline);
  });

  it("classifies in a single Gemini request", async () => {
    const fetchImpl = vi.fn(async () =>
      buildGeminiResponse(
        buildUnifiedPayload("MATCH", "The listing is a clear long-term apartment fit.", ["LONG_TERM"])
      )
    ) as unknown as typeof fetch;

    const result = await classifyListingEligibility(
      listing,
      defaultAppSettings,
      {
        deterministicScore: 82,
        deterministicReason: "Deterministic review needed: score 82; long-term language, balcony mentioned, elevator mentioned.",
        analysisFlags: ["long_term", "balcony_mentioned", "elevator_mentioned"]
      },
      {
        apiKey: "gemini-test-key",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        classifierModel: "gemini-2.5-flash-lite",
        analystModel: "gemini-2.5-flash",
        fetchImpl
      }
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.usedFallback).toBe(false);
    expect(result.eligibilityState).toBe("MATCH");
    expect(result.inputFingerprint).toBe(
      buildSemanticClassificationFingerprint(listing, defaultAppSettings, {
        deterministicScore: 82,
        deterministicReason: "Deterministic review needed: score 82; long-term language, balcony mentioned, elevator mentioned.",
        analysisFlags: ["long_term", "balcony_mentioned", "elevator_mentioned"]
      })
    );
  });

  it("escalates high-score Gemma UNSURE results to the Flash fallback", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("gemma-4-26b-a4b-it")) {
        return buildGeminiResponse(
          buildUnifiedPayload("UNSURE", "The primary model wants a premium check.")
        );
      }

      return buildGeminiResponse(
        buildUnifiedPayload("MATCH", "Flash confirms the listing is a strong fit.", ["LONG_TERM"])
      );
    }) as unknown as typeof fetch;

    const result = await classifyListingEligibility(
      listing,
      defaultAppSettings,
      {
        deterministicScore: 82,
        deterministicReason: "Deterministic review needed: score 82; no strong text signals.",
        analysisFlags: []
      },
      {
        apiKey: "gemini-test-key",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        classifierModel: "gemma-4-26b-a4b-it",
        analystModel: "gemini-2.5-flash",
        fallbackModel: "gemini-2.5-flash",
        fetchImpl,
        allowClassifierFallback: true
      }
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.eligibilityState).toBe("MATCH");
    expect(result.model).toBe("gemini-2.5-flash");
    expect(result.classifierFallbackAttempted).toBe(true);
    expect(result.classifierFallbackSucceeded).toBe(true);
  });

  it("does not escalate low-score Gemma UNSURE results", async () => {
    const fetchImpl = vi.fn(async () =>
      buildGeminiResponse(
        buildUnifiedPayload("UNSURE", "The listing is too ambiguous for premium fallback.")
      )
    ) as unknown as typeof fetch;

    const result = await classifyListingEligibility(
      listing,
      defaultAppSettings,
      {
        deterministicScore: 79,
        deterministicReason: "Deterministic review needed: score 79; no strong text signals.",
        analysisFlags: []
      },
      {
        apiKey: "gemini-test-key",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        classifierModel: "gemma-4-26b-a4b-it",
        analystModel: "gemini-2.5-flash",
        fallbackModel: "gemini-2.5-flash",
        fetchImpl,
        allowClassifierFallback: true
      }
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.eligibilityState).toBe("UNSURE");
    expect(result.model).toBe("gemma-4-26b-a4b-it");
    expect(result.classifierFallbackAttempted).toBe(false);
  });

  it("escalates recoverable primary failures to Flash", async () => {
    let callCount = 0;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      callCount += 1;

      if (String(url).includes("gemma-4-26b-a4b-it")) {
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "not-json" }]
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return buildGeminiResponse(
        buildUnifiedPayload("MATCH", `Flash recovered after ${callCount} calls.`, ["LONG_TERM"])
      );
    }) as unknown as typeof fetch;

    const result = await classifyListingEligibility(
      listing,
      defaultAppSettings,
      {
        deterministicScore: 90,
        deterministicReason: "Deterministic review needed: score 90; no strong text signals.",
        analysisFlags: []
      },
      {
        apiKey: "gemini-test-key",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        classifierModel: "gemma-4-26b-a4b-it",
        analystModel: "gemini-2.5-flash",
        fallbackModel: "gemini-2.5-flash",
        fetchImpl,
        allowClassifierFallback: true
      }
    );

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.usedFallback).toBe(false);
    expect(result.model).toBe("gemini-2.5-flash");
    expect(result.classifierFallbackSucceeded).toBe(true);
  });

  it("does not escalate primary rate limits to Flash", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            message: "Too many requests"
          }
        }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      )
    ) as unknown as typeof fetch;

    const result = await classifyListingEligibility(
      listing,
      defaultAppSettings,
      {
        deterministicScore: 90,
        deterministicReason: "Deterministic review needed: score 90; no strong text signals.",
        analysisFlags: []
      },
      {
        apiKey: "gemini-test-key",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        classifierModel: "gemma-4-26b-a4b-it",
        analystModel: "gemini-2.5-flash",
        fallbackModel: "gemini-2.5-flash",
        fetchImpl,
        allowClassifierFallback: true
      }
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.usedFallback).toBe(true);
    expect(result.errorKind).toBe("rate_limit");
    expect(result.errorSource).toBe("primary");
    expect(result.classifierFallbackAttempted).toBe(false);
  });

  it("retries once on invalid JSON and succeeds on the reduced prompt", async () => {
    let callCount = 0;
    const fetchImpl = vi.fn(async () => {
      callCount += 1;

      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "not-json" }]
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return buildGeminiResponse(
        buildUnifiedPayload("REJECT", "The listing conflicts with the configured avoid rules.", ["SHORT_TERM"])
      );
    }) as unknown as typeof fetch;

    const result = await classifyListingEligibility(
      listing,
      defaultAppSettings,
      {
        deterministicScore: 61,
        deterministicReason: "Deterministic review needed: score 61; no strong text signals.",
        analysisFlags: []
      },
      {
        apiKey: "gemini-test-key",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        classifierModel: "gemini-2.5-flash-lite",
        analystModel: "gemini-2.5-flash",
        fetchImpl
      }
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.usedFallback).toBe(false);
    expect(result.didRetry).toBe(true);
    expect(result.eligibilityState).toBe("REJECT");
  });

  it("falls back cleanly on repeated timeout", async () => {
    const timeoutError = Object.assign(new Error("Request aborted"), {
      name: "AbortError"
    });
    const fetchImpl = vi.fn(async () => {
      throw timeoutError;
    }) as unknown as typeof fetch;

    const result = await classifyListingEligibility(
      listing,
      defaultAppSettings,
      {
        deterministicScore: 70,
        deterministicReason: "Deterministic review needed: score 70; long-term language.",
        analysisFlags: ["long_term"]
      },
      {
        apiKey: "gemini-test-key",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        classifierModel: "gemini-2.5-flash-lite",
        analystModel: "gemini-2.5-flash",
        fetchImpl,
        timeoutMs: 5,
        retryTimeoutMs: 5
      }
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.usedFallback).toBe(true);
    expect(result.errorKind).toBe("timeout");
    expect(result.eligibilityState).toBe("UNSURE");
    expect(result.reason).toContain("Semantic classifier timeout");
  });

  it("uses a deterministic match fallback for strong listings when Gemini is unavailable", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            message: "Too many requests"
          }
        }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      )
    ) as unknown as typeof fetch;

    const result = await classifyListingEligibility(
      {
        ...listing,
        rentWarm: 1450,
        sizeSqm: 80,
        rooms: 3,
        district: "Mitte"
      },
      defaultAppSettings,
      {
        deterministicScore: 91,
        deterministicReason: "Deterministic review needed: score 91; no strong text signals.",
        analysisFlags: []
      },
      {
        apiKey: "gemini-test-key",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        classifierModel: "gemini-2.5-flash-lite",
        analystModel: "gemini-2.5-flash",
        fetchImpl
      }
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.usedFallback).toBe(true);
    expect(result.errorKind).toBe("rate_limit");
    expect(result.eligibilityState).toBe("MATCH");
    expect(result.reason).toContain("deterministic fallback match");
  });
});

describe("generateListingEnglishAnalyst", () => {
  it("persists analyst output for English listings without a separate translation model", async () => {
    const fetchImpl = vi.fn(async () =>
      buildGeminiResponse({
        sourceLanguage: "en",
        translatedTitle: "3 room apartment",
        translatedDescription: "Long-term rental in Berlin with balcony and elevator.",
        eligibilityState: "MATCH",
        reason: "Strong apartment fit.",
        flags: ["LONG_TERM"],
        summary: "Bright long-term Berlin apartment with strong amenity signals.",
        fitNote: "Good fit for the configured couple-friendly long-term search."
      })
    ) as unknown as typeof fetch;

    const result = await generateListingEnglishAnalyst(listing, defaultAppSettings, {
      apiKey: "gemini-test-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      classifierModel: "gemini-2.5-flash-lite",
      analystModel: "gemini-2.5-flash",
      fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.translationSkipped).toBe(true);
    expect(result.llmAnalysis.translationModel).toBeNull();
    expect(result.llmAnalysis.model).toBe("gemini-2.5-flash");
    expect(result.inputFingerprint).toBe(buildEnglishAnalystFingerprint(listing, defaultAppSettings));
  });

  it("returns integrated translation and analysis for German listings", async () => {
    const germanListing: ListingSummary = {
      ...listing,
      title: "3-Zimmer-Wohnung",
      description: "Langfristige Miete in Berlin mit Balkon."
    };
    const fetchImpl = vi.fn(async () =>
      buildGeminiResponse({
        sourceLanguage: "de",
        translatedTitle: "3-room apartment",
        translatedDescription: "Long-term rental in Berlin with balcony.",
        eligibilityState: "MATCH",
        reason: "Clear long-term apartment fit.",
        flags: ["LONG_TERM"],
        summary: "Long-term Berlin apartment with balcony and stable rental framing.",
        fitNote: "Fits the configured apartment profile."
      })
    ) as unknown as typeof fetch;

    const result = await generateListingEnglishAnalyst(germanListing, defaultAppSettings, {
      apiKey: "gemini-test-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      classifierModel: "gemini-2.5-flash-lite",
      analystModel: "gemini-2.5-flash",
      fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.translationSkipped).toBe(false);
    expect(result.llmAnalysis.translationModel).toBeNull();
    expect(result.llmAnalysis.summary).toContain("Long-term Berlin apartment");
    expect(result.llmAnalysis.translatedTitle).toBe("3-room apartment");
  });

  it("surfaces Gemini auth failures cleanly", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            message: "API key not valid. Please pass a valid API key."
          }
        }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      )
    ) as unknown as typeof fetch;

    await expect(
      generateListingEnglishAnalyst(listing, defaultAppSettings, {
        apiKey: "bad-key",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        classifierModel: "gemini-2.5-flash-lite",
        analystModel: "gemini-2.5-flash",
        fetchImpl
      })
    ).rejects.toThrow("API key not valid. Please pass a valid API key.");
  });
});
