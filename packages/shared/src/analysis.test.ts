import { describe, expect, it } from "vitest";

import { defaultAppSettings } from "./settings";
import { evaluateListingDeterministically, extractAnalysisFlags } from "./analysis";

describe("extractAnalysisFlags", () => {
  it("derives blocking and positive signals from listing text and facts", () => {
    const flags = extractAnalysisFlags({
      title: "Unbefristete Wohnung fuer Paare",
      description: "Kein Tausch. Balkon und Aufzug vorhanden, aber WBS notwendig.",
      hasBalcony: true,
      hasElevator: true,
      isFurnished: false
    });

    expect(flags).toEqual(
      expect.arrayContaining(["wbs_required", "couple_friendly", "long_term", "balcony_mentioned", "elevator_mentioned"])
    );
  });
});

describe("evaluateListingDeterministically", () => {
  it("rejects strong blockers before the semantic classifier", () => {
    const result = evaluateListingDeterministically(
      {
        title: "WG-Zimmer mit WBS",
        description: "Befristete Zwischenmiete nur mit WBS.",
        rentWarm: 900,
        district: "Neukoelln",
        rooms: 1,
        sizeSqm: 18
      },
      defaultAppSettings
    );

    expect(result.eligibilityState).toBe("REJECT");
    expect(result.shouldRunSemanticClassifier).toBe(false);
  });

  it("auto-MATCHes listings with all core numeric criteria clearly within bounds", () => {
    const result = evaluateListingDeterministically(
      {
        title: "Bright long-term apartment",
        description: "Long-term rental with balcony in Mitte.",
        rentWarm: 1450,
        district: "Mitte",
        rooms: 3,
        sizeSqm: 80,
        hasBalcony: true
      },
      defaultAppSettings
    );

    expect(result.eligibilityState).toBe("MATCH");
    expect(result.score).toBeGreaterThanOrEqual(78);
    expect(result.shouldRunSemanticClassifier).toBe(false);
  });

  it("routes listings with missing numeric data to the LLM", () => {
    const result = evaluateListingDeterministically(
      {
        title: "Bright long-term apartment",
        description: "Long-term rental with balcony in Mitte.",
        rentWarm: null,
        district: "Mitte",
        rooms: 3,
        sizeSqm: 80,
        hasBalcony: true
      },
      defaultAppSettings
    );

    expect(result.eligibilityState).toBe("UNSURE");
    expect(result.shouldRunSemanticClassifier).toBe(true);
  });
});
