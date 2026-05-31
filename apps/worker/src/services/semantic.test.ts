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

describe("classifyListingEligibility", () => {
  it("classifies in a single Gemini request", async () => {
    const fetchImpl = vi.fn(async () =>
      buildGeminiResponse({
        eligibilityState: "MATCH",
        reason: "The listing is a clear long-term apartment fit.",
        flags: ["LONG_TERM", "COUPLE_FRIENDLY"]
      })
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

      return buildGeminiResponse({
        eligibilityState: "REJECT",
        reason: "The listing conflicts with the configured avoid rules.",
        flags: ["SHORT_TERM"]
      });
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
