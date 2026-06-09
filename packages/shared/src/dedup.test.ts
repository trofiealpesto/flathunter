import { describe, expect, it } from "vitest";

import { findDuplicatePairs, listingsLookLikeDuplicates, type DedupCandidate } from "./dedup";

function candidate(overrides: Partial<DedupCandidate> & { id: number }): DedupCandidate {
  return {
    portal: "IMMOWELT",
    rentCold: 800,
    rentWarm: 1000,
    sizeSqm: 70,
    rooms: 3,
    latitude: 52.49,
    longitude: 13.42,
    addressLine: "Teststraße 1, 10318 Berlin",
    firstSeenAt: "2026-06-01T10:00:00Z",
    ...overrides
  };
}

describe("listingsLookLikeDuplicates", () => {
  const original = candidate({ id: 1 });

  it("matches a near-identical listing on another portal", () => {
    const copy = candidate({
      id: 2,
      portal: "KLEINANZEIGEN",
      rentWarm: 1010,
      sizeSqm: 70.5,
      latitude: 52.4905,
      longitude: 13.4203
    });

    expect(listingsLookLikeDuplicates(original, copy)).toBe(true);
  });

  it("never matches within the same portal", () => {
    expect(listingsLookLikeDuplicates(original, candidate({ id: 2 }))).toBe(false);
  });

  it("rejects when rent, size or rooms differ too much", () => {
    expect(
      listingsLookLikeDuplicates(original, candidate({ id: 2, portal: "KLEINANZEIGEN", rentWarm: 1050 }))
    ).toBe(false);
    expect(
      listingsLookLikeDuplicates(original, candidate({ id: 2, portal: "KLEINANZEIGEN", sizeSqm: 73 }))
    ).toBe(false);
    expect(listingsLookLikeDuplicates(original, candidate({ id: 2, portal: "KLEINANZEIGEN", rooms: 2 }))).toBe(false);
  });

  it("rejects when numeric data is missing", () => {
    expect(
      listingsLookLikeDuplicates(original, candidate({ id: 2, portal: "KLEINANZEIGEN", sizeSqm: null }))
    ).toBe(false);
    expect(
      listingsLookLikeDuplicates(
        original,
        candidate({ id: 2, portal: "KLEINANZEIGEN", rentWarm: null, rentCold: null })
      )
    ).toBe(false);
  });

  it("falls back to postal-code agreement when coordinates are missing", () => {
    const noCoords = candidate({ id: 2, portal: "KLEINANZEIGEN", latitude: null, longitude: null });
    expect(listingsLookLikeDuplicates(original, noCoords)).toBe(true);

    const otherPostal = candidate({
      id: 3,
      portal: "KLEINANZEIGEN",
      latitude: null,
      longitude: null,
      addressLine: "Andere Straße 2, 10999 Berlin"
    });
    expect(listingsLookLikeDuplicates(original, otherPostal)).toBe(false);
  });

  it("rejects far-apart coordinates even with matching numbers", () => {
    const farAway = candidate({
      id: 2,
      portal: "KLEINANZEIGEN",
      latitude: 52.55,
      longitude: 13.3,
      addressLine: null
    });

    expect(listingsLookLikeDuplicates(original, farAway)).toBe(false);
  });
});

describe("findDuplicatePairs", () => {
  it("points later listings at the earliest-seen original", () => {
    const oldest = candidate({ id: 1, firstSeenAt: "2026-06-01T08:00:00Z" });
    const middle = candidate({ id: 2, portal: "KLEINANZEIGEN", firstSeenAt: "2026-06-02T08:00:00Z" });
    const newest = candidate({ id: 3, portal: "INBERLINWOHNEN", firstSeenAt: "2026-06-03T08:00:00Z" });
    const unrelated = candidate({
      id: 4,
      portal: "KLEINANZEIGEN",
      rentWarm: 1500,
      rentCold: null,
      firstSeenAt: "2026-06-04T08:00:00Z"
    });

    const pairs = findDuplicatePairs([newest, unrelated, oldest, middle]);

    expect(pairs.get(2)).toBe(1);
    expect(pairs.get(3)).toBe(1);
    expect(pairs.has(1)).toBe(false);
    expect(pairs.has(4)).toBe(false);
  });
});
