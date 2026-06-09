import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  looksBlockedInberlinwohnenPage,
  looksLikeInberlinwohnenResultsPage,
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
