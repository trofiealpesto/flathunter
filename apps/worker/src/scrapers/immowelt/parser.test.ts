import { describe, expect, it } from "vitest";

import { parseImmoweltDetail, parseImmoweltSearchResults } from "./parser";

const searchHtml = `
  <section>
    <article data-test="listing-card" data-id="abc-123">
      <a data-test="listing-url" href="/expose/abc-123">Open</a>
      <img src="https://static.immowelt.de/images/search-1.jpg" />
      <h2 data-test="listing-title">Bright 3-room flat</h2>
      <span data-test="district">Mitte</span>
      <span data-test="rentWarm">1.650 EUR</span>
      <span data-test="sizeSqm">74 m2</span>
      <span data-test="rooms">3.0</span>
    </article>
  </section>
`;

const detailHtml = `
  <section>
    <div data-test="description">Long-term apartment with balcony</div>
    <img
      data-src="https://static.immowelt.de/images/detail-1.jpg"
      srcset="https://static.immowelt.de/images/detail-1.jpg 1x, https://static.immowelt.de/images/detail-2.jpg 2x"
    />
    <span data-test="city">Berlin</span>
    <span data-test="district">Mitte</span>
    <span data-test="neighborhood">Spandauer Vorstadt</span>
    <span data-test="rentCold">1.400 EUR</span>
    <span data-test="rentWarm">1.650 EUR</span>
    <span data-test="sizeSqm">74 m2</span>
    <span data-test="rooms">3.0</span>
    <span data-test="floor">2</span>
    <span data-test="availableFrom">2026-05-01</span>
    <span data-attr="isFurnished">no</span>
    <span data-attr="hasBalcony">yes</span>
    <span data-attr="hasElevator">no</span>
  </section>
`;

const searchJsonLdHtml = `
  <html>
    <head>
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          "itemListElement": [
            {
              "@type": "ListItem",
              "position": 1,
              "item": {
                "@type": "Apartment",
                "name": "JSON-LD apartment",
                "url": "https://www.immowelt.de/expose/json-1",
                "image": ["https://static.immowelt.de/images/json-1.jpg"],
                "offers": { "price": "1490" },
                "floorSize": { "value": "58" },
                "numberOfRooms": "2.5",
                "address": {
                  "@type": "PostalAddress",
                  "addressRegion": "Kreuzberg"
                }
              }
            }
          ]
        }
      </script>
    </head>
    <body></body>
  </html>
`;

const liveCardHtml = `
  <section>
    <div data-testid="serp-core-classified-card-testid">
      <a
        data-testid="card-mfe-covering-link-testid"
        href="https://www.immowelt.de/expose/live-123"
        title="Wohnung zur Miete - Berlin - 1.799 € - 3 Zimmer, 81,4 m², 4. Geschoss"
      ></a>
      <img src="https://static.immowelt.de/images/live-123.jpg" />
      <div>1.799 €</div>
      <div>Kaltmiete</div>
      <div>Wohnung zur Miete</div>
      <div>3 Zimmer</div>
      <div>81,4 m²</div>
      <div>4. Geschoss</div>
      <div>Friedenauer Höhe 6, Friedenau, Berlin (12159)</div>
    </div>
    <article>
      <a href="https://immowelt.go.link/51hzi">Jetzt unsere App aus dem Google Play Store laden.</a>
    </article>
  </section>
`;

const detailLabelHtml = `
  <section>
    <div>Beschreibung</div>
    <div>Unbefristete Wohnung mit Balkon und Aufzug.</div>
    <div>Warmmiete</div>
    <div>1750 EUR</div>
    <div>Wohnflaeche</div>
    <div>70 m2</div>
    <div>Zimmer</div>
    <div>3</div>
    <div>Frei ab</div>
    <div>sofort</div>
  </section>
`;

describe("parseImmoweltSearchResults", () => {
  it("extracts normalized search results", () => {
    const results = parseImmoweltSearchResults(searchHtml, "https://www.immowelt.de/liste/berlin");

    expect(results).toEqual([
      {
        portalListingId: "abc-123",
        title: "Bright 3-room flat",
        url: "https://www.immowelt.de/expose/abc-123",
        coverImageUrl: "https://static.immowelt.de/images/search-1.jpg",
        imageUrls: ["https://static.immowelt.de/images/search-1.jpg"],
        addressLine: null,
        district: "Mitte",
        latitude: null,
        longitude: null,
        rentCold: null,
        rentWarm: 1650,
        sizeSqm: 74,
        rooms: 3
      }
    ]);
  });

  it("falls back to JSON-LD search results when cards are missing", () => {
    const results = parseImmoweltSearchResults(searchJsonLdHtml, "https://www.immowelt.de/liste/berlin");

    expect(results).toEqual([
      {
        portalListingId: "json-1",
        title: "JSON-LD apartment",
        url: "https://www.immowelt.de/expose/json-1",
        coverImageUrl: "https://static.immowelt.de/images/json-1.jpg",
        imageUrls: ["https://static.immowelt.de/images/json-1.jpg"],
        addressLine: "Kreuzberg",
        district: "Kreuzberg",
        latitude: null,
        longitude: null,
        rentCold: null,
        rentWarm: 1490,
        sizeSqm: 58,
        rooms: 2.5
      }
    ]);
  });

  it("parses live SERP cards and skips promo app links", () => {
    const results = parseImmoweltSearchResults(liveCardHtml, "https://www.immowelt.de/liste/berlin");

    expect(results).toEqual([
      {
        portalListingId: "live-123",
        title: "Wohnung zur Miete",
        url: "https://www.immowelt.de/expose/live-123",
        coverImageUrl: "https://static.immowelt.de/images/live-123.jpg",
        imageUrls: ["https://static.immowelt.de/images/live-123.jpg"],
        addressLine: "Friedenauer H\u00f6he 6, Friedenau, Berlin (12159)",
        district: "Friedenau",
        latitude: null,
        longitude: null,
        rentCold: 1799,
        rentWarm: null,
        sizeSqm: 81.4,
        rooms: 3
      }
    ]);
  });
});

describe("parseImmoweltDetail", () => {
  it("extracts detail attributes", () => {
    const detail = parseImmoweltDetail(detailHtml);

    expect(detail.title).toBeNull();
    expect(detail.description).toContain("balcony");
    expect(detail.coverImageUrl).toBe("https://static.immowelt.de/images/detail-1.jpg");
    expect(detail.imageUrls).toEqual([
      "https://static.immowelt.de/images/detail-1.jpg",
      "https://static.immowelt.de/images/detail-2.jpg"
    ]);
    expect(detail.hasBalcony).toBe(true);
    expect(detail.rentCold).toBe(1400);
  });

  it("extracts detail values from label-value fallbacks", () => {
    const detail = parseImmoweltDetail(detailLabelHtml);

    expect(detail.description).toMatch(/wohnung/i);
    expect(detail.rentWarm).toBe(1750);
    expect(detail.sizeSqm).toBe(70);
    expect(detail.rooms).toBe(3);
    expect(detail.availableFrom).toBe("sofort");
    expect(detail.hasBalcony).toBe(true);
    expect(detail.hasElevator).toBe(true);
    expect(detail.coverImageUrl).toBeNull();
    expect(detail.imageUrls).toEqual([]);
  });
});
