import { describe, expect, it } from "vitest";

import type { ListingDetail } from "@flathunter/shared";

import { getListingPrimaryAction } from "./listingDetail";

const listing: ListingDetail = {
  id: 1,
  portal: "IMMOWELT",
  portalListingId: "1",
  url: "https://www.immowelt.de/expose/1",
  canonicalUrl: "https://www.immowelt.de/expose/1",
  title: "Listing",
  description: null,
  addressLine: null,
  city: "Berlin",
  district: "Mitte",
  neighborhood: null,
  latitude: null,
  longitude: null,
  geoSource: null,
  distanceKm: null,
  rentCold: null,
  rentWarm: null,
  sizeSqm: null,
  rooms: null,
  floor: null,
  availableFrom: null,
  isFurnished: false,
  hasBalcony: false,
  hasElevator: false,
  score: null,
  commuteMinutes: null,
  commuteSource: null,
  userStatus: "NEW",
  eligibilityState: "UNSURE",
  eligibilityReason: null,
  sourceMode: null,
  analysisFlags: [],
  semanticFlags: [],
  semanticModel: null,
  llmAnalysis: null,
  llmAnalysisStatus: "missing",
  firstSeenAt: new Date().toISOString(),
  lastSeenAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  rawPayload: null
};

describe("getListingPrimaryAction", () => {
  it("routes fixture listings to the configured portal search", () => {
    expect(
      getListingPrimaryAction(
        {
          ...listing,
          sourceMode: "fixture"
        },
        true,
        "https://www.immowelt.de/liste/berlin"
      ).url
    ).toBe("https://www.immowelt.de/liste/berlin");
  });

  it("uses the original listing URL in live mode", () => {
    expect(
      getListingPrimaryAction(
        {
          ...listing,
          sourceMode: "live"
        },
        false,
        null
      ).url
    ).toBe(listing.url);
  });
});
