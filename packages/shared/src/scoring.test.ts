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

  it("matches preferred districts case-insensitively", () => {
    const score = computeDeterministicScore(
      {
        rentWarm: 1600,
        sizeSqm: 60,
        rooms: 2,
        district: "mitte"
      },
      defaultAppSettings
    );

    expect(score).toBeGreaterThanOrEqual(62);
  });

  const baseListing = {
    rentWarm: 1600,
    sizeSqm: 60,
    rooms: 2
  };

  it("penalizes commutes above the configured threshold only", () => {
    const withoutCommute = computeDeterministicScore(baseListing, defaultAppSettings);
    const shortCommute = computeDeterministicScore(baseListing, defaultAppSettings, [], { commuteMinutes: 25 });
    const longCommute = computeDeterministicScore(baseListing, defaultAppSettings, [], { commuteMinutes: 55 });

    expect(shortCommute).toBe(withoutCommute);
    // 20 minutes over the 35-minute default at 5 points per 10 minutes = -10.
    expect(longCommute).toBe(withoutCommute - 10);
  });

  it("rewards fresh listings and decays the bonus after 72 hours", () => {
    const now = new Date("2026-06-09T12:00:00Z");
    const base = computeDeterministicScore(baseListing, defaultAppSettings, [], { now });
    const fresh = computeDeterministicScore(baseListing, defaultAppSettings, [], {
      now,
      firstSeenAt: "2026-06-09T06:00:00Z"
    });
    const recent = computeDeterministicScore(baseListing, defaultAppSettings, [], {
      now,
      firstSeenAt: "2026-06-07T12:00:00Z"
    });
    const old = computeDeterministicScore(baseListing, defaultAppSettings, [], {
      now,
      firstSeenAt: "2026-06-01T12:00:00Z"
    });

    expect(fresh).toBe(base + 8);
    expect(recent).toBe(base + 4);
    expect(old).toBe(base);
  });

  it("adjusts the score against the district price baseline", () => {
    const listing = { rentCold: 600, sizeSqm: 60, rooms: 2 }; // 10 EUR/sqm

    const base = computeDeterministicScore(listing, defaultAppSettings);
    const cheap = computeDeterministicScore(listing, defaultAppSettings, [], { districtMedianRentPerSqm: 12.5 }); // 20% below median
    const expensive = computeDeterministicScore(listing, defaultAppSettings, [], { districtMedianRentPerSqm: 8 }); // 25% above median

    expect(cheap).toBe(base + 4);
    expect(expensive).toBe(base - 5);
  });
});
