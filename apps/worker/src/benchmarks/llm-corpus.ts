import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { EligibilityState, ListingSummary, Portal } from "@flathunter/shared";

import { parseImmoweltDetail, parseImmoweltSearchResults } from "../scrapers/immowelt/parser";
import { parseImmoscout24Detail, parseImmoscout24SearchResults } from "../scrapers/immoscout24/parser";
import { parseKleinanzeigenDetail, parseKleinanzeigenSearchResults } from "../scrapers/kleinanzeigen/parser";
import { parseWgGesuchtDetail, parseWgGesuchtSearchResults } from "../scrapers/wg-gesucht/parser";

type BenchmarkExpectation = {
  eligibilityState: EligibilityState;
  requiredFlags: string[];
};

export type LlmBenchmarkCase = {
  id: string;
  translationSpotCheck: boolean;
  listing: ListingSummary;
  expectation: BenchmarkExpectation;
};

const benchmarkTimestamp = "2026-04-03T00:00:00.000Z";
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(currentDir, "../fixtures");

function readFixture(...segments: string[]) {
  return readFileSync(path.join(fixturesDir, ...segments), "utf8");
}

function createListingSummary(
  id: number,
  portal: Portal,
  data: Partial<
    Pick<
      ListingSummary,
      | "portalListingId"
      | "url"
      | "canonicalUrl"
      | "title"
      | "description"
      | "addressLine"
      | "city"
      | "district"
      | "neighborhood"
      | "latitude"
      | "longitude"
      | "geoSource"
      | "rentCold"
      | "rentWarm"
      | "sizeSqm"
      | "rooms"
      | "floor"
      | "availableFrom"
      | "isFurnished"
      | "hasBalcony"
      | "hasElevator"
    >
  >
): ListingSummary {
  return {
    id,
    portal,
    portalListingId: data.portalListingId ?? `benchmark-${portal.toLowerCase()}-${id}`,
    url: data.url ?? `https://example.com/${portal.toLowerCase()}/${id}`,
    canonicalUrl: data.canonicalUrl ?? data.url ?? `https://example.com/${portal.toLowerCase()}/${id}`,
    title: data.title ?? `Benchmark ${portal} listing ${id}`,
    description: data.description ?? null,
    addressLine: data.addressLine ?? null,
    city: data.city ?? "Berlin",
    district: data.district ?? null,
    neighborhood: data.neighborhood ?? null,
    latitude: data.latitude ?? null,
    longitude: data.longitude ?? null,
    geoSource: data.geoSource ?? null,
    distanceKm: null,
    rentCold: data.rentCold ?? null,
    rentWarm: data.rentWarm ?? null,
    sizeSqm: data.sizeSqm ?? null,
    rooms: data.rooms ?? null,
    floor: data.floor ?? null,
    availableFrom: data.availableFrom ?? null,
    isFurnished: data.isFurnished ?? false,
    hasBalcony: data.hasBalcony ?? false,
    hasElevator: data.hasElevator ?? false,
    score: null,
    userStatus: "NEW",
    eligibilityState: "UNSURE",
    eligibilityReason: null,
    sourceMode: "fixture",
    analysisFlags: [],
    semanticFlags: [],
    semanticModel: null,
    llmAnalysis: null,
    llmAnalysisStatus: "missing",
    firstSeenAt: benchmarkTimestamp,
    lastSeenAt: benchmarkTimestamp,
    createdAt: benchmarkTimestamp,
    updatedAt: benchmarkTimestamp
  };
}

export function loadLlmBenchmarkCorpus(): LlmBenchmarkCase[] {
  const immoweltSearch = parseImmoweltSearchResults(
    readFixture("immowelt", "search.html"),
    "https://www.immowelt.de/liste/berlin/wohnungen/mieten"
  );
  const immoweltDetail1 = parseImmoweltDetail(
    readFixture("immowelt", "detail-1.html")
  );
  const immoweltDetail2 = parseImmoweltDetail(
    readFixture("immowelt", "detail-2.html")
  );
  const wgSearch = parseWgGesuchtSearchResults(
    readFixture("wg-gesucht", "search.html"),
    "https://www.wg-gesucht.de/wohnungen-in-Berlin.8.2.1.0.html"
  );
  const wgDetail = parseWgGesuchtDetail(
    readFixture("wg-gesucht", "detail-1.html"),
    wgSearch[0]?.url ?? "https://www.wg-gesucht.de/wohnungen-in-Berlin.8.2.1.0.html"
  );
  const kleinanzeigenSearch = parseKleinanzeigenSearchResults(
    readFixture("kleinanzeigen", "search.html"),
    "https://www.kleinanzeigen.de/s-wohnung-mieten/berlin/c203l3331"
  );
  const kleinanzeigenDetail = parseKleinanzeigenDetail(readFixture("kleinanzeigen", "detail-1.html"));
  const immoscout24Search = parseImmoscout24SearchResults(
    readFixture("immoscout24", "search.html"),
    "https://www.immobilienscout24.de/Suche/de/berlin/wohnung-mieten"
  );
  const immoscout24Detail = parseImmoscout24Detail(readFixture("immoscout24", "detail-1.html"));

  const cases: LlmBenchmarkCase[] = [
    {
      id: "immowelt-search-1",
      translationSpotCheck: false,
      expectation: {
        eligibilityState: "MATCH",
        requiredFlags: []
      },
      listing: createListingSummary(1, "IMMOWELT", {
        ...immoweltSearch[0]
      })
    },
    {
      id: "immowelt-search-2",
      translationSpotCheck: false,
      expectation: {
        eligibilityState: "MATCH",
        requiredFlags: []
      },
      listing: createListingSummary(2, "IMMOWELT", {
        ...immoweltSearch[1]
      })
    },
    {
      id: "immowelt-detail-1",
      translationSpotCheck: false,
      expectation: {
        eligibilityState: "MATCH",
        requiredFlags: ["long_term"]
      },
      listing: createListingSummary(3, "IMMOWELT", {
        portalListingId: immoweltSearch[0]?.portalListingId ?? "immowelt-detail-1",
        url: immoweltSearch[0]?.url,
        canonicalUrl: immoweltSearch[0]?.url,
        title: immoweltSearch[0]?.title ?? "Immowelt detail 1",
        description: immoweltDetail1.description,
        addressLine: immoweltDetail1.addressLine ?? immoweltSearch[0]?.addressLine ?? null,
        city: immoweltDetail1.city ?? "Berlin",
        district: immoweltDetail1.district,
        neighborhood: immoweltDetail1.neighborhood,
        rentCold: immoweltDetail1.rentCold,
        rentWarm: immoweltDetail1.rentWarm,
        sizeSqm: immoweltDetail1.sizeSqm,
        rooms: immoweltDetail1.rooms,
        floor: immoweltDetail1.floor,
        availableFrom: immoweltDetail1.availableFrom,
        isFurnished: immoweltDetail1.isFurnished,
        hasBalcony: immoweltDetail1.hasBalcony,
        hasElevator: immoweltDetail1.hasElevator
      })
    },
    {
      id: "immowelt-detail-2",
      translationSpotCheck: false,
      expectation: {
        eligibilityState: "MATCH",
        requiredFlags: ["long_term"]
      },
      listing: createListingSummary(4, "IMMOWELT", {
        portalListingId: immoweltSearch[1]?.portalListingId ?? "immowelt-detail-2",
        url: immoweltSearch[1]?.url,
        canonicalUrl: immoweltSearch[1]?.url,
        title: immoweltSearch[1]?.title ?? "Immowelt detail 2",
        description: immoweltDetail2.description,
        addressLine: immoweltDetail2.addressLine ?? immoweltSearch[1]?.addressLine ?? null,
        city: immoweltDetail2.city ?? "Berlin",
        district: immoweltDetail2.district,
        neighborhood: immoweltDetail2.neighborhood,
        rentCold: immoweltDetail2.rentCold,
        rentWarm: immoweltDetail2.rentWarm,
        sizeSqm: immoweltDetail2.sizeSqm,
        rooms: immoweltDetail2.rooms,
        floor: immoweltDetail2.floor,
        availableFrom: immoweltDetail2.availableFrom,
        isFurnished: immoweltDetail2.isFurnished,
        hasBalcony: immoweltDetail2.hasBalcony,
        hasElevator: immoweltDetail2.hasElevator
      })
    },
    {
      id: "wg-search-1",
      translationSpotCheck: true,
      expectation: {
        eligibilityState: "MATCH",
        requiredFlags: []
      },
      listing: createListingSummary(5, "WG_GESUCHT", {
        ...wgSearch[0]
      })
    },
    {
      id: "wg-detail-1",
      translationSpotCheck: true,
      expectation: {
        eligibilityState: "MATCH",
        requiredFlags: []
      },
      listing: createListingSummary(6, "WG_GESUCHT", {
        portalListingId: wgSearch[0]?.portalListingId ?? "wg-detail-1",
        url: wgSearch[0]?.url,
        canonicalUrl: wgSearch[0]?.url,
        title: wgDetail.title ?? wgSearch[0]?.title ?? "WG detail 1",
        description: wgDetail.description,
        addressLine: wgDetail.addressLine ?? wgSearch[0]?.addressLine ?? null,
        city: wgDetail.city ?? "Berlin",
        district: wgDetail.district,
        neighborhood: wgDetail.neighborhood,
        rentWarm: wgDetail.rentWarm,
        sizeSqm: wgDetail.sizeSqm,
        rooms: wgDetail.rooms,
        isFurnished: wgDetail.isFurnished,
        hasBalcony: wgDetail.hasBalcony,
        hasElevator: wgDetail.hasElevator
      })
    },
    {
      id: "kleinanzeigen-search-1",
      translationSpotCheck: true,
      expectation: {
        eligibilityState: "MATCH",
        requiredFlags: []
      },
      listing: createListingSummary(7, "KLEINANZEIGEN", {
        ...kleinanzeigenSearch[0]
      })
    },
    {
      id: "kleinanzeigen-detail-1",
      translationSpotCheck: true,
      expectation: {
        eligibilityState: "MATCH",
        requiredFlags: ["furnished"]
      },
      listing: createListingSummary(8, "KLEINANZEIGEN", {
        portalListingId: kleinanzeigenSearch[0]?.portalListingId ?? "kleinanzeigen-detail-1",
        url: kleinanzeigenSearch[0]?.url,
        canonicalUrl: kleinanzeigenSearch[0]?.url,
        title: kleinanzeigenDetail.title ?? kleinanzeigenSearch[0]?.title ?? "Kleinanzeigen detail 1",
        description: kleinanzeigenDetail.description,
        addressLine: kleinanzeigenDetail.addressLine ?? kleinanzeigenSearch[0]?.addressLine ?? null,
        city: kleinanzeigenDetail.city ?? "Berlin",
        district: kleinanzeigenDetail.district,
        neighborhood: kleinanzeigenDetail.neighborhood,
        latitude: kleinanzeigenDetail.latitude,
        longitude: kleinanzeigenDetail.longitude,
        rentCold: kleinanzeigenDetail.rentCold,
        rentWarm: kleinanzeigenDetail.rentWarm,
        sizeSqm: kleinanzeigenDetail.sizeSqm,
        rooms: kleinanzeigenDetail.rooms,
        floor: kleinanzeigenDetail.floor,
        availableFrom: kleinanzeigenDetail.availableFrom,
        isFurnished: kleinanzeigenDetail.isFurnished,
        hasBalcony: kleinanzeigenDetail.hasBalcony,
        hasElevator: kleinanzeigenDetail.hasElevator
      })
    },
    {
      id: "immoscout24-search-1",
      translationSpotCheck: true,
      expectation: {
        eligibilityState: "MATCH",
        requiredFlags: []
      },
      listing: createListingSummary(9, "IMMOSCOUT24", {
        ...immoscout24Search[0]
      })
    },
    {
      id: "immoscout24-detail-1",
      translationSpotCheck: true,
      expectation: {
        eligibilityState: "MATCH",
        requiredFlags: []
      },
      listing: createListingSummary(10, "IMMOSCOUT24", {
        portalListingId: immoscout24Search[0]?.portalListingId ?? "immoscout24-detail-1",
        url: immoscout24Search[0]?.url,
        canonicalUrl: immoscout24Search[0]?.url,
        title: immoscout24Detail.title ?? immoscout24Search[0]?.title ?? "Immoscout24 detail 1",
        description: immoscout24Detail.description,
        addressLine: immoscout24Detail.addressLine ?? immoscout24Search[0]?.addressLine ?? null,
        city: immoscout24Detail.city ?? "Berlin",
        district: immoscout24Detail.district,
        neighborhood: immoscout24Detail.neighborhood,
        latitude: immoscout24Detail.latitude,
        longitude: immoscout24Detail.longitude,
        rentWarm: immoscout24Detail.rentWarm,
        sizeSqm: immoscout24Detail.sizeSqm,
        rooms: immoscout24Detail.rooms,
        isFurnished: immoscout24Detail.isFurnished,
        hasBalcony: immoscout24Detail.hasBalcony,
        hasElevator: immoscout24Detail.hasElevator
      })
    },
    {
      id: "wg-title-only",
      translationSpotCheck: false,
      expectation: {
        eligibilityState: "UNSURE",
        requiredFlags: []
      },
      listing: createListingSummary(11, "WG_GESUCHT", {
        portalListingId: wgSearch[0]?.portalListingId ?? "wg-title-only",
        url: wgSearch[0]?.url,
        canonicalUrl: wgSearch[0]?.url,
        title: wgDetail.title ?? wgSearch[0]?.title ?? "WG title only",
        description: null,
        city: "Berlin",
        district: wgDetail.district,
        neighborhood: wgDetail.neighborhood,
        rentWarm: wgDetail.rentWarm,
        sizeSqm: wgDetail.sizeSqm,
        rooms: wgDetail.rooms
      })
    },
    {
      id: "kleinanzeigen-title-only",
      translationSpotCheck: false,
      expectation: {
        eligibilityState: "UNSURE",
        requiredFlags: []
      },
      listing: createListingSummary(12, "KLEINANZEIGEN", {
        portalListingId: kleinanzeigenSearch[0]?.portalListingId ?? "kleinanzeigen-title-only",
        url: kleinanzeigenSearch[0]?.url,
        canonicalUrl: kleinanzeigenSearch[0]?.url,
        title: kleinanzeigenDetail.title ?? kleinanzeigenSearch[0]?.title ?? "Kleinanzeigen title only",
        description: null,
        city: "Berlin",
        district: kleinanzeigenDetail.district,
        neighborhood: kleinanzeigenDetail.neighborhood,
        rentWarm: kleinanzeigenDetail.rentWarm,
        sizeSqm: kleinanzeigenDetail.sizeSqm,
        rooms: kleinanzeigenDetail.rooms
      })
    }
  ];

  if (cases.length !== 12) {
    throw new Error(`Expected 12 benchmark cases, received ${cases.length}`);
  }

  return cases;
}
