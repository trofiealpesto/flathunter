import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { looksBlockedWgGesuchtPage, looksNonListingWgGesuchtPage, parseWgGesuchtDetail, parseWgGesuchtSearchResults } from "./parser";

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/wg-gesucht");
const searchHtml = readFileSync(path.join(fixturesDir, "search.html"), "utf8");
const detailHtml = readFileSync(path.join(fixturesDir, "detail-1.html"), "utf8");
const imageSearchHtml = `
  <section>
    <article class="offer_list_item" data-id="10000002">
      <h2><a href="/wohnungen-in-Berlin-Neukoelln.10000002.html">Altbauwohnung in Neukölln</a></h2>
      <img src="https://img.wg-gesucht.de/listing-1.jpg" />
      <div class="card_body">2 Zimmer 63 m² 1450 €</div>
      <div class="col-sm-3"><b>Weserstraße 1, 12045 Berlin Neukölln</b></div>
    </article>
  </section>
`;
const imageDetailHtml = `
  <html>
    <head>
      <title>Altbauwohnung in Neukölln - Wohnung in Berlin-Neukölln</title>
      <meta
        name="Description"
        content="Wohnung in Berlin-Neukölln, 2 Zimmer, 63 m², 1450 €."
      />
      <meta property="og:image" content="https://img.wg-gesucht.de/detail-cover.jpg" />
    </head>
    <body>
      <img src="/images/detail-2.jpg" />
    </body>
  </html>
`;
const promoDetailHtml = `
  <html>
    <head>
      <title>Studio-Apartment ist verfügbar - Wohnung in Berlin-Charlottenburg-Wilmersdorf</title>
      <meta
        name="Description"
        content="Studio-Apartment zu vermieten. Ein schönes und gut gepflegtes Studio-Apartment ist verfügbar."
      />
    </head>
    <body>
      <div class="marketing-banner">
        Schon ab <b>35,58 €</b> - boosten Sie jetzt Ihre Anzeige!
      </div>
      <div class="row">
        <div class="col-xs-4 text-center">
          <span class="key_fact_detail">Größe</span>
          <b class="key_fact_value">36m²</b>
        </div>
        <div class="col-xs-4 text-center">
          <span class="key_fact_detail">Gesamtmiete</span>
          <b class="key_fact_value">1050€</b>
        </div>
        <div class="col-xs-4 text-center">
          <span class="key_fact_detail">Zimmer</span>
          <b class="key_fact_value">1</b>
        </div>
      </div>
      <div class="row">
        <div class="col-xs-6">
          <span class="section_panel_detail">frei ab:</span>
        </div>
        <div class="col-xs-6">
          <span class="section_panel_value">01.06.2026</span>
        </div>
      </div>
    </body>
  </html>
`;

describe("parseWgGesuchtSearchResults", () => {
  it("extracts normalized search-card data", () => {
    const results = parseWgGesuchtSearchResults(searchHtml, "https://www.wg-gesucht.de/wohnungen-in-Berlin.8.2.1.0.html");

    expect(results).toEqual([
      {
        portalListingId: "10000001",
        title: "Zentrale Wohnung in Mitte",
        url: "https://www.wg-gesucht.de/wohnungen-in-Berlin-Mitte.10000001.html",
        coverImageUrl: null,
        imageUrls: [],
        addressLine: "Linienstraße 1, 10115 Berlin Mitte",
        district: "Mitte",
        latitude: null,
        longitude: null,
        rentCold: null,
        rentWarm: 1300,
        sizeSqm: 55,
        rooms: 2
      }
    ]);
  });
});

describe("parseWgGesuchtDetail", () => {
  it("extracts detail metadata and amenities", () => {
    const result = parseWgGesuchtDetail(
      detailHtml,
      "https://www.wg-gesucht.de/wohnungen-in-Berlin-Mitte.10000001.html"
    );

    expect(result).toMatchObject({
      title: "Zentrale Wohnung in Mitte",
      coverImageUrl: null,
      imageUrls: [],
      city: "Berlin",
      district: "Mitte",
      neighborhood: "Mitte",
      rentWarm: 1300,
      sizeSqm: 55,
      rooms: 2,
      isFurnished: true,
      hasBalcony: true
    });
  });

  it("collects listing images from markup and meta tags", () => {
    const searchResults = parseWgGesuchtSearchResults(
      imageSearchHtml,
      "https://www.wg-gesucht.de/wohnungen-in-Berlin.8.2.1.0.html"
    );
    const detailResult = parseWgGesuchtDetail(
      imageDetailHtml,
      "https://www.wg-gesucht.de/wohnungen-in-Berlin-Neukoelln.10000002.html"
    );

    expect(searchResults[0]).toMatchObject({
      coverImageUrl: "https://img.wg-gesucht.de/listing-1.jpg",
      imageUrls: ["https://img.wg-gesucht.de/listing-1.jpg"]
    });
    expect(detailResult.coverImageUrl).toBe("https://img.wg-gesucht.de/detail-cover.jpg");
    expect(detailResult.imageUrls).toEqual([
      "https://img.wg-gesucht.de/detail-cover.jpg",
      "https://www.wg-gesucht.de/images/detail-2.jpg"
    ]);
  });

  it("prefers listing key facts over unrelated promo euro amounts", () => {
    const result = parseWgGesuchtDetail(
      promoDetailHtml,
      "https://www.wg-gesucht.de/wohnungen-in-Berlin-Charlottenburg-Wilmersdorf.13302959.html"
    );

    expect(result).toMatchObject({
      title: "Studio-Apartment ist verfügbar",
      rentWarm: 1050,
      sizeSqm: 36,
      rooms: 1,
      availableFrom: "01.06.2026"
    });
  });
});

describe("WG-Gesucht page guards", () => {
  it("detects blocked and non-listing pages", () => {
    expect(looksBlockedWgGesuchtPage("<html><body>Access denied. Please solve the captcha.</body></html>")).toBe(true);
    expect(
      looksBlockedWgGesuchtPage(
        '<html><head><meta name="robots" content="index, follow"><script src="https://www.recaptcha.net/recaptcha.js"></script></head><body><main>Wohnungen in Berlin</main></body></html>'
      )
    ).toBe(false);
    expect(looksNonListingWgGesuchtPage("https://www.wg-gesucht.de/impressum.html", "<html></html>")).toBe(true);
    expect(
      looksNonListingWgGesuchtPage(
        "https://www.wg-gesucht.de/wohnungen-in-Berlin-Mitte.10000001.html",
        detailHtml
      )
    ).toBe(false);
  });
});
