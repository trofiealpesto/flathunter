import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  AVAILABLE_NOW,
  looksBlockedInberlinwohnenPage,
  looksLikeInberlinwohnenResultsPage,
  parseInberlinwohnenAvailableFrom,
  parseInberlinwohnenResultsCount,
  parseInberlinwohnenSearchResults
} from "./parser";

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/inberlinwohnen");
const searchHtml = readFileSync(path.join(fixturesDir, "search.html"), "utf8");

describe("parseInberlinwohnenSearchResults", () => {
  it("extracts all apartment cards from the live capture", () => {
    const results = parseInberlinwohnenSearchResults(searchHtml);

    expect(results).toHaveLength(10);

    for (const result of results) {
      expect(result.flatId).toBeGreaterThan(0);
      expect(result.deeplink).toMatch(/^https?:\/\//);
      expect(result.title.length).toBeGreaterThan(0);
    }
  });

  it("extracts structured fields for the first card", () => {
    const [first] = parseInberlinwohnenSearchResults(searchHtml);

    expect(first).toMatchObject({
      flatId: 17758,
      objectId: "ESQ 1770/20554/60",
      title: "Familienwohung für Sportbegeisterte, Wohnung früher verfügbar",
      deeplink: "https://www.howoge.de/wohnungen-gewerbe/wohnungssuche/detail/1770-20554-60.html?t=ibw",
      rooms: 3,
      sizeSqm: 60.65,
      rentCold: 621.66,
      extraCosts: 123.82,
      rentWarm: 840,
      availableFrom: "2026-07-01",
      floor: 5,
      floorsTotal: 5,
      wbs: "erforderlich",
      street: "Ilsestraße",
      houseNumber: "60",
      zipCode: "10318",
      district: "Lichtenberg"
    });

    expect(first.latitude).toBeCloseTo(52.49087146, 5);
    expect(first.longitude).toBeCloseTo(13.51801399, 5);
    expect(first.postedAt).toMatch(/^2026-06-09T/);
  });

  it("detects balcony and elevator badges per card", () => {
    const results = parseInberlinwohnenSearchResults(searchHtml);

    const withBalcony = results.filter((item) => item.hasBalcony);
    const withElevator = results.filter((item) => item.hasElevator);

    expect(withBalcony.length).toBeGreaterThan(0);
    expect(withElevator.length).toBeGreaterThan(0);
  });

  it("reads an occupation date equal to the posting day as available now", () => {
    const second = parseInberlinwohnenSearchResults(searchHtml)[1];

    expect(second.occupationDate).toBe("09.06.2026");
    expect(second.postedAt).toMatch(/^2026-06-09T/);
    expect(second.availableFrom).toBe(AVAILABLE_NOW);
  });
});

describe("parseInberlinwohnenAvailableFrom", () => {
  it("keeps a future move-in date", () => {
    expect(parseInberlinwohnenAvailableFrom("01.02.2027", "2026-11-10T17:15:06.000000Z")).toBe("2027-02-01");
  });

  it("treats the posting day as available now", () => {
    expect(parseInberlinwohnenAvailableFrom("10.11.2026", "2026-11-10T17:28:08.000000Z")).toBe(AVAILABLE_NOW);
  });

  it("treats a date before the posting day as available now", () => {
    expect(parseInberlinwohnenAvailableFrom("01.10.2026", "2026-10-29T15:42:06.000000Z")).toBe(AVAILABLE_NOW);
  });

  it("compares with the posting day in Berlin, not UTC", () => {
    // 23:30 UTC on 10 Nov is already 11 Nov in Berlin.
    expect(parseInberlinwohnenAvailableFrom("11.11.2026", "2026-11-10T23:30:00.000000Z")).toBe(AVAILABLE_NOW);
    expect(parseInberlinwohnenAvailableFrom("12.11.2026", "2026-11-10T23:30:00.000000Z")).toBe("2026-11-12");
  });

  it("keeps the date when the posting time is missing", () => {
    expect(parseInberlinwohnenAvailableFrom("10.11.2026", null)).toBe("2026-11-10");
  });

  it("drops malformed dates and typo years", () => {
    expect(parseInberlinwohnenAvailableFrom("ready_for_occupancy", "2026-11-10T10:00:00Z")).toBeNull();
    expect(parseInberlinwohnenAvailableFrom("20.10.0026", "2026-10-29T15:42:06.000000Z")).toBeNull();
  });
});

describe("parseInberlinwohnenResultsCount", () => {
  it("extracts the total offer count", () => {
    expect(parseInberlinwohnenResultsCount(searchHtml)).toBe(246);
  });
});

describe("page sanity checks", () => {
  it("recognizes a results page", () => {
    expect(looksLikeInberlinwohnenResultsPage(searchHtml)).toBe(true);
    expect(looksLikeInberlinwohnenResultsPage("<html><body>nothing here</body></html>")).toBe(false);
  });

  it("does not flag the live capture as blocked", () => {
    expect(looksBlockedInberlinwohnenPage(searchHtml)).toBe(false);
  });
});
