import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  looksBlockedImmoscout24Page,
  looksNonListingImmoscout24Page,
  parseImmoscout24Detail,
  parseImmoscout24SearchResults
} from "./parser";

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/immoscout24");
const searchHtml = readFileSync(path.join(fixturesDir, "search.html"), "utf8");
const detailHtml = readFileSync(path.join(fixturesDir, "detail-1.html"), "utf8");

describe("parseImmoscout24SearchResults", () => {
  it("extracts listings from the search page", () => {
    const results = parseImmoscout24SearchResults(
      searchHtml,
      "https://www.immobilienscout24.de/Suche/de/berlin/berlin/wohnung-mieten"
    );

    expect(results).toEqual([
      {
        portalListingId: "90000001",
        title: "Wohnung zur Miete in Berlin-Mitte",
        url: "https://www.immobilienscout24.de/expose/90000001",
        coverImageUrl: null,
        imageUrls: [],
        addressLine: null,
        district: "Mitte",
        latitude: null,
        longitude: null,
        rentCold: null,
        rentWarm: 1650,
        sizeSqm: 65,
        rooms: 2
      }
    ]);
  });
});

describe("parseImmoscout24Detail", () => {
  it("extracts detail text fields", () => {
    const result = parseImmoscout24Detail(detailHtml);

    expect(result).toMatchObject({
      title: "Wohnung zur Miete in Berlin-Mitte",
      description: "65 m² Wohnung mit 2 Zimmern in Berlin-Mitte.",
      city: "Berlin",
      district: "Mitte",
      neighborhood: "Mitte",
      rentWarm: null,
      sizeSqm: 65,
      rooms: 2
    });
  });
});

describe("ImmoScout24 page guards", () => {
  it("detects blocked and non-listing pages", () => {
    expect(looksBlockedImmoscout24Page("<html><body>Ich bin kein Roboter</body></html>")).toBe(true);
    expect(looksNonListingImmoscout24Page("https://www.immobilienscout24.de/hilfe", "<html></html>")).toBe(true);
    expect(
      looksNonListingImmoscout24Page("https://www.immobilienscout24.de/expose/90000001", detailHtml)
    ).toBe(false);
  });
});
