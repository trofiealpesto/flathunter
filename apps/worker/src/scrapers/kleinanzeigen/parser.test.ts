import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  looksBlockedKleinanzeigenPage,
  looksNonListingKleinanzeigenPage,
  parseKleinanzeigenDetail,
  parseKleinanzeigenSearchResults
} from "./parser";

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/kleinanzeigen");
const searchHtml = readFileSync(path.join(fixturesDir, "search.html"), "utf8");
const detailHtml = readFileSync(path.join(fixturesDir, "detail-1.html"), "utf8");

describe("parseKleinanzeigenSearchResults", () => {
  it("extracts search-card data", () => {
    const results = parseKleinanzeigenSearchResults(searchHtml, "https://www.kleinanzeigen.de/s-wohnung-mieten/berlin/c203l3331");

    expect(results).toEqual([
      {
        portalListingId: "30000001",
        title: "Moderne Wohnung in Mitte",
        url: "https://www.kleinanzeigen.de/s-anzeige/moderne-wohnung-in-mitte/30000001-203-3331",
        coverImageUrl: null,
        imageUrls: [],
        addressLine: "10115 Berlin - Mitte",
        district: "Mitte",
        latitude: null,
        longitude: null,
        rentCold: null,
        rentWarm: 1450,
        sizeSqm: 58,
        rooms: 2
      }
    ]);
  });
});

describe("parseKleinanzeigenDetail", () => {
  it("extracts detail values and geo metadata", () => {
    const result = parseKleinanzeigenDetail(detailHtml);

    expect(result).toMatchObject({
      title: "Moderne Wohnung in Mitte",
      city: "Berlin",
      district: "Mitte",
      neighborhood: "Mitte",
      latitude: 52.525,
      longitude: 13.388,
      rentCold: 1200,
      rentWarm: 1450,
      sizeSqm: 58,
      rooms: 2,
      floor: "3",
      availableFrom: "Mai 2026",
      isFurnished: true,
      hasBalcony: true,
      hasElevator: true
    });
  });
});

describe("Kleinanzeigen page guards", () => {
  it("detects blocked and non-listing pages", () => {
    expect(looksBlockedKleinanzeigenPage("<html><body>Captcha challenge</body></html>")).toBe(true);
    expect(looksNonListingKleinanzeigenPage("https://www.kleinanzeigen.de/s-ratgeber", "<html></html>")).toBe(true);
    expect(
      looksNonListingKleinanzeigenPage(
        "https://www.kleinanzeigen.de/s-anzeige/moderne-wohnung-in-mitte/30000001-203-3331",
        detailHtml
      )
    ).toBe(false);
  });
});
