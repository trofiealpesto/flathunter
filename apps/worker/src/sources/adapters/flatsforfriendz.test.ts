import { describe, expect, it, vi } from "vitest";

import { defaultAppSettings } from "@flathunter/shared";

import { readWorkerEnv } from "../../config";
import { flatsforfriendzAdapter, scrapeFlatsforfriendzFeed } from "./flatsforfriendz";

function createContext(fetchImpl: typeof fetch) {
  return {
    env: readWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://unused",
      PORTAL_SECRETS_KEY: "portal-secrets-key-for-tests",
      GEMINI_API_KEY: "gemini-test-key",
      GEMINI_API_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
      IMMOWELT_SEARCH_URL: "https://www.immowelt.de/liste/berlin/wohnungen/mieten",
      IMMOWELT_ENABLE_LIVE_BROWSER: "true",
      WORKER_DEV_INTERVAL_MS: "300000"
    }),
    settings: defaultAppSettings,
    searchUrl: "https://app.flatsforfriendz.com/en?locations=Berlin&types=FLAT",
    searchParams: {
      city: "Berlin",
      feedType: "OFFER",
      types: ["FLAT"],
      language: "en"
    },
    scrapeWithFixtures: false,
    sessionState: null,
    credentials: null,
    fetchImpl
  };
}

function buildOfferEntry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    type: "offerListing",
    data: {
      uuid: "11111111-1111-4111-8111-111111111111",
      displayId: "FFF-111",
      info: "Bright Berlin flat with balcony and elevator.",
      name: "Bright Berlin flat",
      type: "FLAT",
      price: 1450,
      deposit: 2500,
      rentalPeriod: "LIMITED",
      startTime: "2026-05-01T00:00:00.000Z",
      endTime: "2026-12-31T00:00:00.000Z",
      furnished: "FULLY_FURNISHED",
      furnitureObjects: ["BED", "DESK"],
      contracts: ["INTERNET"],
      special: ["BALCONY", "ELEVATOR"],
      friendliness: ["COUPLES"],
      rooms: 2,
      size: 58,
      roomSize: null,
      visibility: "PUBLIC",
      visuals: [{ url: "https://cdn.flatsforfriendz.test/cover.jpg" }, { url: "https://cdn.flatsforfriendz.test/2.jpg" }],
      address: {
        postalCode: "10961",
        cityPart: "Kreuzberg",
        city: "Berlin",
        fuzzyLat: 52.498,
        fuzzyLong: 13.403
      },
      ...overrides
    }
  };
}

describe("flatsforfriendzAdapter", () => {
  it("builds an experimental public-api default source", () => {
    const source = flatsforfriendzAdapter.defaultSource(defaultAppSettings, readWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://unused",
      PORTAL_SECRETS_KEY: "portal-secrets-key-for-tests",
      GEMINI_API_KEY: "gemini-test-key",
      GEMINI_API_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
      IMMOWELT_SEARCH_URL: "https://www.immowelt.de/liste/berlin/wohnungen/mieten",
      IMMOWELT_ENABLE_LIVE_BROWSER: "true",
      WORKER_DEV_INTERVAL_MS: "300000"
    }));

    expect(source.searchUrl).toBe("https://app.flatsforfriendz.com/en?locations=Berlin&types=FLAT");
    expect(source.searchParams).toMatchObject({
      city: "Berlin",
      feedType: "OFFER",
      types: ["FLAT"],
      language: "en"
    });
    expect(flatsforfriendzAdapter.capabilities).toMatchObject({
      sourceKind: "public_api",
      readiness: "experimental",
      cloudCompatible: true,
      supportsLogin: false,
      requiresAuthSetup: false
    });
  });

  it("paginates, filters public Berlin offer listings, and maps images and canonical URLs", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              buildOfferEntry(),
              buildOfferEntry({
                uuid: "22222222-2222-4222-8222-222222222222",
                displayId: "FFF-222",
                name: "Private listing",
                visibility: "PRIVATE"
              }),
              buildOfferEntry({
                uuid: "33333333-3333-4333-8333-333333333333",
                displayId: "FFF-333",
                name: "Hamburg flat",
                address: {
                  postalCode: "20095",
                  cityPart: "Altstadt",
                  city: "Hamburg",
                  fuzzyLat: 53.55,
                  fuzzyLong: 10
                }
              })
            ],
            meta: {
              page: 1,
              take: 25,
              isLastPage: false
            }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              buildOfferEntry({
                uuid: "44444444-4444-4444-8444-444444444444",
                displayId: "FFF-444",
                name: "Second page Berlin flat",
                visuals: [{ url: "https://cdn.flatsforfriendz.test/4.jpg" }]
              }),
              {
                type: "searchRequest",
                data: {
                  uuid: "55555555-5555-4555-8555-555555555555",
                  displayId: "FFF-555",
                  name: "Wrong feed type",
                  type: "FLAT",
                  price: 900,
                  visibility: "PUBLIC",
                  visuals: [],
                  address: {
                    city: "Berlin",
                    cityPart: "Mitte",
                    postalCode: "10115",
                    fuzzyLat: 52.52,
                    fuzzyLong: 13.38
                  }
                }
              }
            ],
            meta: {
              page: 2,
              take: 25,
              isLastPage: true
            }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    const result = await scrapeFlatsforfriendzFeed(createContext(fetchImpl));

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("page=1");
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain("page=2");
    expect(result).toMatchObject({
      mode: "live",
      authStatus: "ready",
      listingsFound: 2,
      failedDetails: 0
    });
    expect(result.listings).toHaveLength(2);
    expect(result.listings[0]).toMatchObject({
      portal: "FLATSFORFRIENDZ",
      portalListingId: "FFF-111",
      url: "https://app.flatsforfriendz.com/listing/offer/11111111-1111-4111-8111-111111111111",
      canonicalUrl: "https://app.flatsforfriendz.com/listing/offer/11111111-1111-4111-8111-111111111111",
      title: "Bright Berlin flat",
      city: "Berlin",
      district: "Kreuzberg",
      neighborhood: "Kreuzberg",
      rentWarm: 1450,
      sizeSqm: 58,
      rooms: 2,
      isFurnished: true,
      hasBalcony: true,
      hasElevator: true,
      rawPayload: {
        source: "live",
        search: {
          displayId: "FFF-111",
          coverImageUrl: "https://cdn.flatsforfriendz.test/cover.jpg",
          imageUrls: ["https://cdn.flatsforfriendz.test/cover.jpg", "https://cdn.flatsforfriendz.test/2.jpg"]
        }
      }
    });
    expect(result.listings[1]?.portalListingId).toBe("FFF-444");
  });

  it("marks non-json html responses as anti-bot challenges", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("<html><body>Just a moment...</body></html>", { status: 200 })) as unknown as typeof fetch;

    const result = await scrapeFlatsforfriendzFeed(createContext(fetchImpl));

    expect(result).toMatchObject({
      listingsFound: 0,
      authStatus: "challenge_required",
      challengeType: "anti_bot"
    });
    expect(result.authError).toContain("non-JSON challenge");
  });
});
