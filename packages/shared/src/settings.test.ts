import { describe, expect, it } from "vitest";

import { appSettingsSchema } from "./settings";

describe("appSettingsSchema", () => {
  it("maps legacy Ollama runtime keys to Gemini runtime settings", () => {
    const parsed = appSettingsSchema.parse({
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
    });

    expect(parsed.runtime).toEqual({
      llmProvider: "gemini",
      enableSemanticClassifier: true,
      enableLlmEnrichment: true,
      llmClassifierModel: "gemma4:latest",
      llmAnalystModel: "translategemma:4b",
      scrapeWithFixtures: false
    });
  });
});
