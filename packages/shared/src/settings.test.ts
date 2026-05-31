import { describe, expect, it } from "vitest";

import { appSettingsSchema } from "./settings";

describe("appSettingsSchema", () => {
  it("defaults the classifier to Gemma with Flash fallback", () => {
    const runtime = appSettingsSchema.parse({ ...defaultSettingsInput(), runtime: {} }).runtime;

    expect(runtime.llmClassifierModel).toBe("gemma-4-26b-a4b-it");
    expect(runtime.llmClassifierFallbackEnabled).toBe(true);
    expect(runtime.llmClassifierFallbackModel).toBe("gemini-2.5-flash");
    expect(runtime.llmClassifierFallbackMinScore).toBe(80);
  });

  it("maps legacy Ollama runtime keys to Gemini runtime settings", () => {
    const parsed = appSettingsSchema.parse({
      ...defaultSettingsInput(),
      runtime: {
        enableSemanticClassifier: true,
        enableLlmEnrichment: true,
        ollamaModel: "gemma4:latest",
        ollamaTranslationModel: "translategemma:4b",
        scrapeWithFixtures: false
      }
    });

    expect(parsed.runtime).toEqual({
      llmProvider: "gemini",
      enableSemanticClassifier: true,
      enableLlmEnrichment: true,
      llmClassifierModel: "gemma4:latest",
      llmClassifierFallbackEnabled: true,
      llmClassifierFallbackModel: "gemini-2.5-flash",
      llmClassifierFallbackMinScore: 80,
      llmAnalystModel: "translategemma:4b",
      scrapeWithFixtures: false
    });
  });
});

function defaultSettingsInput() {
  return {
    scoring: {
      maxWarmRent: 1800,
      minimumSizeSqm: 50,
      minimumRooms: 2,
      preferredDistricts: ["Mitte"],
      balconyBonus: 5,
      elevatorBonus: 3,
      furnishedPenalty: 8
    },
    search: {
      city: "Berlin",
      districts: ["Mitte"],
      immoweltSearchUrl: "https://www.immowelt.de/liste/berlin/wohnungen/mieten",
      officeLocation: null
    },
    semanticRules: {
      mustMatch: ["apartment"],
      avoid: ["swap only"],
      notes: "test"
    },
    runtime: {
      enableSemanticClassifier: true,
      enableLlmEnrichment: true,
      ollamaModel: "gemma4:latest",
      ollamaTranslationModel: "translategemma:4b",
      scrapeWithFixtures: false
    },
    profile: {
      fullName: "",
      shortBio: "",
      email: "",
      phone: ""
    }
  };
}
