import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ListingUpsertInput } from "@flathunter/shared";

import {
  looksBlockedInberlinwohnenPage,
  looksLikeInberlinwohnenResultsPage,
  parseInberlinwohnenResultsCount,
  parseInberlinwohnenSearchResults,
  type InberlinwohnenItem
} from "../../scrapers/inberlinwohnen/parser";
import type { SourceAdapter, SourceScrapeResult } from "../types";

const INBERLINWOHNEN_SEARCH_URL = "https://inberlinwohnen.de/wohnungsfinder/";
const MAX_PAGES = 30;
const PAGE_DELAY_MS = 750;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

function fixturesDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/inberlinwohnen");
}

function buildDescription(item: InberlinwohnenItem) {
  const parts: string[] = [];

  if (item.companyName) {
    parts.push(`Anbieter: ${item.companyName.trim()}`);
  }

  const coreFacts = [
    item.rooms != null ? `${item.rooms} Zimmer` : null,
    item.sizeSqm != null ? `${item.sizeSqm} m²` : null,
    item.rentCold != null ? `Kaltmiete ${item.rentCold} €` : null,
    item.extraCosts != null ? `Nebenkosten ${item.extraCosts} €` : null,
    item.rentWarm != null ? `Gesamtmiete ${item.rentWarm} €` : null
  ].filter(Boolean);

  if (coreFacts.length > 0) {
    parts.push(coreFacts.join(" · "));
  }

  if (item.floor != null) {
    parts.push(item.floorsTotal != null ? `Etage ${item.floor} von ${item.floorsTotal}` : `Etage ${item.floor}`);
  }

  if (item.constructionYear) {
    parts.push(`Baujahr ${item.constructionYear}`);
  }

  if (item.wbs) {
    parts.push(`WBS ${item.wbs}`);
  }

  if (item.availableFrom) {
    parts.push(`Bezugsfertig ab ${item.availableFrom}`);
  }

  if (item.badges.length > 0) {
    parts.push(`Ausstattung: ${[...new Set(item.badges)].join(", ")}`);
  }

  return parts.join(". ") || null;
}

function buildAddressLine(item: InberlinwohnenItem) {
  const street = [item.street, item.houseNumber].filter(Boolean).join(" ");
  const locality = [item.zipCode, item.district].filter(Boolean).join(" ");
  const line = [street || null, locality || null].filter(Boolean).join(", ");
  return line || null;
}

function toListingInput(item: InberlinwohnenItem, rawPayload: Record<string, unknown>): ListingUpsertInput {
  return {
    portal: "INBERLINWOHNEN",
    portalListingId: item.objectId ?? String(item.flatId),
    url: item.deeplink,
    canonicalUrl: item.deeplink,
    title: item.title,
    description: buildDescription(item),
    addressLine: buildAddressLine(item),
    city: "Berlin",
    district: item.district,
    neighborhood: null,
    latitude: item.latitude,
    longitude: item.longitude,
    geoSource: item.latitude != null && item.longitude != null ? "portal_coordinates" : null,
    rentCold: item.rentCold,
    rentWarm: item.rentWarm,
    sizeSqm: item.sizeSqm,
    rooms: item.rooms,
    floor: item.floor != null ? String(item.floor) : null,
    availableFrom: item.availableFrom,
    isFurnished: false,
    hasBalcony: item.hasBalcony,
    hasElevator: item.hasElevator,
    rawPayload
  };
}

function blockedResult(message: string): SourceScrapeResult {
  return {
    listings: [],
    listingsFound: 0,
    failedDetails: 0,
    detailFailures: {
      blocked: 0,
      invalid: 0,
      error: 0
    },
    mode: "live",
    authStatus: "challenge_required",
    authError: message,
    challengeType: "anti_bot",
    sessionState: null,
    sessionExpiresAt: null,
    authenticatedAt: null,
    validatedAt: new Date()
  };
}

function successResult(listings: ListingUpsertInput[], mode: SourceScrapeResult["mode"]): SourceScrapeResult {
  return {
    listings,
    listingsFound: listings.length,
    failedDetails: 0,
    detailFailures: {
      blocked: 0,
      invalid: 0,
      error: 0
    },
    mode,
    authStatus: "ready",
    authError: null,
    challengeType: null,
    sessionState: null,
    sessionExpiresAt: null,
    authenticatedAt: null,
    validatedAt: new Date()
  };
}

async function scrapeFixtures(): Promise<SourceScrapeResult> {
  const html = await readFile(path.join(fixturesDir(), "search.html"), "utf8");
  const items = parseInberlinwohnenSearchResults(html);

  return successResult(
    items.map((item) => toListingInput(item, { source: "fixture", item })),
    "fixture"
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function scrapeInberlinwohnen(
  context: Parameters<SourceAdapter["scrape"]>[0]
): Promise<SourceScrapeResult> {
  if (context.scrapeWithFixtures) {
    return scrapeFixtures();
  }

  const fetchImpl = context.fetchImpl ?? fetch;
  const baseUrl = context.searchUrl || INBERLINWOHNEN_SEARCH_URL;
  const listings: ListingUpsertInput[] = [];
  const seenFlatIds = new Set<number>();
  let totalOffers: number | null = null;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const pageUrl = new URL(baseUrl);

    if (page > 1) {
      pageUrl.searchParams.set("page", String(page));
    }

    const response = await fetchImpl(pageUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8"
      }
    });

    if (!response.ok) {
      if (page === 1) {
        return blockedResult(`inberlinwohnen request failed with status ${response.status}`);
      }
      break;
    }

    const html = await response.text();

    if (looksBlockedInberlinwohnenPage(html)) {
      if (page === 1) {
        return blockedResult("inberlinwohnen returned a bot-protection or block page.");
      }
      break;
    }

    if (!looksLikeInberlinwohnenResultsPage(html)) {
      if (page === 1) {
        return blockedResult("inberlinwohnen returned an unexpected page without apartment results.");
      }
      break;
    }

    totalOffers ??= parseInberlinwohnenResultsCount(html);
    const items = parseInberlinwohnenSearchResults(html);

    if (items.length === 0) {
      break;
    }

    let sawNewItem = false;

    for (const item of items) {
      if (seenFlatIds.has(item.flatId)) {
        continue;
      }

      seenFlatIds.add(item.flatId);
      sawNewItem = true;
      listings.push(toListingInput(item, { source: "live", page, item }));
    }

    // Repeated pages mean pagination wrapped around — stop instead of looping.
    if (!sawNewItem) {
      break;
    }

    if (totalOffers != null && listings.length >= totalOffers) {
      break;
    }

    await sleep(PAGE_DELAY_MS);
  }

  return successResult(listings, "live");
}

export const inberlinwohnenAdapter: SourceAdapter = {
  portal: "INBERLINWOHNEN",
  capabilities: {
    supportsLogin: false,
    supportsCaptchaSolver: false,
    supportsDetailFallback: false,
    sourceKind: "scraping",
    readiness: "secondary",
    cloudCompatible: true,
    requiresAuthSetup: false,
    setupHint:
      "Aggregator for Berlin's state-owned housing companies. No account setup required; listings vanish quickly, so keep the scrape interval short."
  },
  defaultSource(settings) {
    return {
      searchUrl: INBERLINWOHNEN_SEARCH_URL,
      searchParams: {
        city: settings.search.city,
        districts: settings.search.districts
      },
      scrapeIntervalMinutes: 5
    };
  },
  async scrape(context) {
    return scrapeInberlinwohnen(context);
  }
};
