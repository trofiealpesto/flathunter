import { describe, expect, it } from "vitest";

import { defaultAppSettings } from "./settings";
import { evaluateListingDeterministically, extractAnalysisFlags } from "./analysis";

const numericOnlySettings = {
  ...defaultAppSettings,
  semanticRules: { mustMatch: [], avoid: [], notes: "" }
};
const affordableListing = {
  title: "Wohnung in Berlin", description: "", rentWarm: 1400,
  district: "Mitte", rooms: 3, sizeSqm: 80
};

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

  it.each([
    "Kein WBS erforderlich. Keine Zwischenmiete, kein Wohnungstausch, kein WG-Zimmer.",
    "A housing permit is not required. This is not an apartment swap or a temporary sublet.",
    "WBS isn't required. Not a room in a shared flat.",
    "Eine WG wohnt nebenan. Diese ganze Wohnung ist für eine eigene Familie.",
    "There is a shared flat next door. This is an entire apartment.",
    "Previously a temporary sublet, now a permanent direct lease.",
    "Früher Zwischenmiete. Jetzt unbefristet.",
    "WBS required? Please ask the landlord.",
    "See the WBS information page for municipal advice.",
    "Die Nachbarwohnung benötigt WBS, diese hier nicht.",
    "The neighbouring flat requires a housing permit; this apartment does not.",
    "Unbefristete Untermiete der ganzen Wohnung.",
    "An apartment for roommates, not a room-only offer."
  ])("does not infer blockers from negated, historical or incidental mentions: %s", (description) => {
    const flags = extractAnalysisFlags({ ...affordableListing, description });
    expect(flags.filter((flag) => ["wbs_required", "temporary_sublet", "swap_only", "room_only"].includes(flag))).toEqual([]);
  });

  it("keeps negations local to the relevant clause and requirement", () => {
    expect(extractAnalysisFlags({ description: "Kein WBS erforderlich, aber Wohnungstausch. Keine Zwischenmiete." }))
      .toContain("swap_only");
    expect(extractAnalysisFlags({ description: "No deposit, but WBS required." })).toContain("wbs_required");
  });

  it("normalizes umlauts without breaking words or negation", () => {
    const flags = extractAnalysisFlags({ description: "Nur mit gültigem WBS. Möblierte Wohnung für Paare." });
    expect(flags).toContain("wbs_required");
    expect(flags).toContain("couple_friendly");
    expect(extractAnalysisFlags({ description: "Nicht langfristig verfügbar." })).not.toContain("long_term");
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

  it("auto-MATCHes numeric-only searches when all numeric criteria are met", () => {
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
      numericOnlySettings
    );

    expect(result.eligibilityState).toBe("MATCH");
    expect(result.score).toBeGreaterThanOrEqual(78);
    expect(result.shouldRunSemanticClassifier).toBe(false);
  });

  it.each([
    "WBS required. WBS is not required.",
    "WBS ist erforderlich. Kein WBS notwendig.",
    "Wohnungstausch. Kein Wohnungstausch.",
    "Unbefristete Wohnung. Befristet für 3 Monate.",
    "Permanent rental, but temporary sublet for 3 months.",
    "Optional apartment swap if you are interested."
  ])("routes conflicting or conditional text to semantic review: %s", (description) => {
    const result = evaluateListingDeterministically({ ...affordableListing, description }, defaultAppSettings);
    expect(result.eligibilityState).toBe("UNSURE");
    expect(result.shouldRunSemanticClassifier).toBe(true);
    expect(result.analysisFlags.filter((flag) => ["wbs_required", "temporary_sublet", "swap_only", "room_only"].includes(flag))).toEqual([]);
  });

  it("detects contradictions across title and description", () => {
    const result = evaluateListingDeterministically({ ...affordableListing,
      title: "WBS-Wohnung", description: "Ein WBS ist nicht erforderlich."
    }, defaultAppSettings);
    expect(result.eligibilityState).toBe("UNSURE");
    expect(result.analysisFlags).not.toContain("wbs_required");
  });

  it.each([
    "WBS erforderlich.", "A housing permit is required.", "You need a WBS.",
    "Wohnungstausch.", "Apartment swap only.", "Befristet für 3 Monate.",
    "Befristeter Mietvertrag.", "A fixed-term rental for three months.",
    "Temporary sublet for 3 months.", "WG-Zimmer.", "One bedroom in a shared flat."
  ])("still rejects explicit restrictions: %s", (description) => {
    const result = evaluateListingDeterministically({ ...affordableListing, description }, defaultAppSettings);
    expect(result.eligibilityState).toBe("REJECT");
    expect(result.shouldRunSemanticClassifier).toBe(false);
  });

  it.each([
    { mustMatch: ["Voglio un ascensore"], avoid: [], notes: "" },
    { mustMatch: [], avoid: ["Anmeldung forbidden"], notes: "" },
    { mustMatch: [], avoid: [], notes: "Registration must be possible." },
    defaultAppSettings.semanticRules
  ])("does not bypass configured text requirements with a numeric MATCH", (semanticRules) => {
    const result = evaluateListingDeterministically(affordableListing, { ...defaultAppSettings, semanticRules });
    expect(result.eligibilityState).toBe("UNSURE");
    expect(result.shouldRunSemanticClassifier).toBe(true);
  });

  it.each([{ rentWarm: 2200 }, { sizeSqm: 30 }, { rooms: 1 }])("preserves numeric rejections despite ambiguous text: %s", (numeric) => {
    const result = evaluateListingDeterministically({ ...affordableListing, ...numeric,
      description: "WBS required. No WBS required."
    }, defaultAppSettings);
    expect(result.eligibilityState).toBe("REJECT");
    expect(result.reason).not.toContain("WBS");
  });

  it("does not penalize negated blockers in ranking", () => {
    const plain = evaluateListingDeterministically(affordableListing, defaultAppSettings);
    const negated = evaluateListingDeterministically({ ...affordableListing,
      description: "Kein WBS erforderlich; keine Zwischenmiete; kein Wohnungstausch; kein WG-Zimmer."
    }, defaultAppSettings);
    expect(negated.score).toBe(plain.score);
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
