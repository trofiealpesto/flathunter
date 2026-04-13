import { describe, expect, it } from "vitest";

import { computeDeterministicScore, canonicalizeListingUrl } from "./scoring";
import { defaultAppSettings } from "./settings";

describe("canonicalizeListingUrl", () => {
  it("strips query string and hash", () => {
    expect(canonicalizeListingUrl("https://example.com/path?a=1#hello")).toBe("https://example.com/path");
  });
});

describe("computeDeterministicScore", () => {
  it("rewards larger and cheaper listings", () => {
    const score = computeDeterministicScore(
      {
        rentWarm: 1450,
        sizeSqm: 78,
        rooms: 3,
        hasBalcony: true,
        district: "Mitte",
        isFurnished: false
      },
      defaultAppSettings
    );

    expect(score).toBeGreaterThan(60);
  });

  it("penalizes furnished expensive listings", () => {
    const score = computeDeterministicScore(
      {
        rentWarm: 2200,
        sizeSqm: 42,
        rooms: 1,
        isFurnished: true
      },
      defaultAppSettings
    );

    expect(score).toBeLessThan(40);
  });
});

