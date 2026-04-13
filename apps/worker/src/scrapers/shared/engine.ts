import { promises as fs } from "node:fs";
import path from "node:path";

import { listingUpsertInputSchema, type ListingUpsertInput, type Portal, type SourceAuthStatus, type SourceRunMode } from "@flathunter/shared";

import { launchScraperContext, type BrowserLauncher, jitterDelay, mapWithConcurrency, scrapePageHtml, withRetry } from "../../sources/browser";
import type { SourceCredentials, SourceSessionState, SourceScrapeResult } from "../../sources/types";

export type SearchResult = {
  portalListingId: string | null;
  title: string;
  url: string;
  coverImageUrl: string | null;
  imageUrls: string[];
  addressLine: string | null;
  district: string | null;
  latitude: number | null;
  longitude: number | null;
  rentCold: number | null;
  rentWarm: number | null;
  sizeSqm: number | null;
  rooms: number | null;
};

export type DetailResult = {
  title: string | null;
  description: string | null;
  coverImageUrl: string | null;
  imageUrls: string[];
  addressLine: string | null;
  city: string | null;
  district: string | null;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
  rentCold: number | null;
  rentWarm: number | null;
  sizeSqm: number | null;
  rooms: number | null;
  floor: string | null;
  availableFrom: string | null;
  isFurnished: boolean;
  hasBalcony: boolean;
  hasElevator: boolean;
};

export type PortalScraperOptions = {
  portal: Portal;
  searchUrl: string;
  fixturesDir: string;
  enableLiveBrowser: boolean;
  requestTimeoutMs?: number;
  maxDetailConcurrency?: number;
  maxRetries?: number;
  browserLauncher?: BrowserLauncher;
  proxyUrl?: string;
  blockedResourceTypes?: Array<"image" | "media" | "font">;
  sessionState?: SourceSessionState | null;
  credentials?: SourceCredentials | null;
  parseSearchResults: (html: string, baseUrl: string) => SearchResult[];
  parseDetail: (html: string, url: string) => DetailResult;
  looksBlockedPage: (html: string) => boolean;
  looksNonListingPage: (url: string, html: string) => boolean;
  buildEmptyDetailFallback?: () => DetailResult;
  countRecoveredLiveFallbacksAsFailures?: boolean;
};

const defaultEmptyDetailFallback = (): DetailResult => ({
  title: null,
  description: null,
  coverImageUrl: null,
  imageUrls: [],
  addressLine: null,
  city: "Berlin",
  district: null,
  neighborhood: null,
  latitude: null,
  longitude: null,
  rentCold: null,
  rentWarm: null,
  sizeSqm: null,
  rooms: null,
  floor: null,
  availableFrom: null,
  isFurnished: false,
  hasBalcony: false,
  hasElevator: false
});

async function readFixture(fixturesDir: string, fileName: string) {
  return fs.readFile(path.join(fixturesDir, fileName), "utf8");
}

function buildListingInput(
  portal: Portal,
  result: SearchResult,
  detail: DetailResult,
  rawPayload: Record<string, unknown>
) {
  return listingUpsertInputSchema.safeParse({
    portal,
    portalListingId: result.portalListingId,
    url: result.url,
    canonicalUrl: result.url,
    title: detail.title ?? result.title,
    description: detail.description,
    addressLine: detail.addressLine ?? result.addressLine,
    city: detail.city,
    district: detail.district ?? result.district,
    neighborhood: detail.neighborhood,
    latitude: detail.latitude ?? result.latitude,
    longitude: detail.longitude ?? result.longitude,
    rentCold: detail.rentCold ?? result.rentCold,
    rentWarm: detail.rentWarm ?? result.rentWarm,
    sizeSqm: detail.sizeSqm ?? result.sizeSqm,
    rooms: detail.rooms ?? result.rooms,
    floor: detail.floor,
    availableFrom: detail.availableFrom,
    isFurnished: detail.isFurnished,
    hasBalcony: detail.hasBalcony,
    hasElevator: detail.hasElevator,
    rawPayload
  });
}

function buildResult(
  partial: Omit<
    SourceScrapeResult,
    "mode" | "authStatus" | "authError" | "challengeType" | "sessionState" | "sessionExpiresAt" | "authenticatedAt" | "validatedAt"
  >,
  mode: SourceRunMode,
  authStatus: SourceAuthStatus,
  sessionState: SourceSessionState | null,
  metadata?: {
    authError?: string | null;
    challengeType?: string | null;
    expiresAt?: Date | null;
    authenticatedAt?: Date | null;
    validatedAt?: Date | null;
  }
): SourceScrapeResult {
  return {
    ...partial,
    mode,
    authStatus,
    authError: metadata?.authError ?? null,
    challengeType: metadata?.challengeType ?? null,
    sessionState,
    sessionExpiresAt: metadata?.expiresAt ?? null,
    authenticatedAt: metadata?.authenticatedAt ?? null,
    validatedAt: metadata?.validatedAt ?? null
  };
}

async function scrapeFixtures(options: PortalScraperOptions): Promise<SourceScrapeResult> {
  const searchHtml = await readFixture(options.fixturesDir, "search.html");
  const searchResults = options.parseSearchResults(searchHtml, options.searchUrl);
  const listings: ListingUpsertInput[] = [];
  let failedDetails = 0;
  const detailFailures = {
    blocked: 0,
    invalid: 0,
    error: 0
  };
  const emptyDetailFallback = options.buildEmptyDetailFallback ?? defaultEmptyDetailFallback;

  for (const [index, result] of searchResults.entries()) {
    try {
      const detailHtml = await readFixture(options.fixturesDir, `detail-${index + 1}.html`);
      const detail = options.parseDetail(detailHtml, result.url);
      const parsed = buildListingInput(options.portal, result, detail, {
        source: "fixture",
        search: result,
        detail
      });

      if (parsed.success) {
        listings.push(parsed.data);
      } else {
        failedDetails += 1;
        detailFailures.invalid += 1;
      }
    } catch {
      const parsed = buildListingInput(options.portal, result, emptyDetailFallback(), {
        source: "fixture",
        search: result,
        detail: null,
        detailStatus: "error"
      });

      failedDetails += 1;
      detailFailures.error += 1;

      if (parsed.success) {
        listings.push(parsed.data);
      }
    }
  }

  return buildResult(
    {
      listings,
      listingsFound: searchResults.length,
      failedDetails,
      detailFailures
    },
    "fixture",
    "ready",
    null
  );
}

async function scrapeLive(options: PortalScraperOptions): Promise<SourceScrapeResult> {
  const timeoutMs = options.requestTimeoutMs ?? 20_000;
  const maxRetries = options.maxRetries ?? 2;
  const maxDetailConcurrency = options.maxDetailConcurrency ?? 2;
  const emptyDetailFallback = options.buildEmptyDetailFallback ?? defaultEmptyDetailFallback;
  const { browser, context } = await launchScraperContext({
    browserLauncher: options.browserLauncher,
    proxyUrl: options.proxyUrl,
    storageState: options.sessionState,
    blockedResourceTypes: options.blockedResourceTypes
  });
  const countRecoveredLiveFallbacksAsFailures = options.countRecoveredLiveFallbacksAsFailures ?? true;

  try {
    const searchPage = await context.newPage();
    const searchHtml = await withRetry(() => scrapePageHtml(searchPage, options.searchUrl, timeoutMs), maxRetries, 500);
    await searchPage.close();

    if (options.looksBlockedPage(searchHtml)) {
      const storageState = await context.storageState();
      return buildResult(
        {
          listings: [],
          listingsFound: 0,
          failedDetails: 0,
          detailFailures: {
            blocked: 0,
            invalid: 0,
            error: 0
          }
        },
        "live",
        "challenge_required",
        storageState as SourceSessionState,
        {
          authError: "Search page returned an unavailable, blocked, or robot challenge response",
          challengeType: "anti_bot",
          validatedAt: new Date()
        }
      );
    }

    const searchResults = options.parseSearchResults(searchHtml, options.searchUrl);
    let failedDetails = 0;
    const detailFailures = {
      blocked: 0,
      invalid: 0,
      error: 0
    };

    const listingResults = await mapWithConcurrency(searchResults, maxDetailConcurrency, async (result, index) => {
      if (index > 0) {
        await jitterDelay(500, 2_000);
      }

      const detailPage = await context.newPage();

      try {
        const detailHtml = await withRetry(() => scrapePageHtml(detailPage, result.url, timeoutMs), maxRetries, 500);

        if (options.looksBlockedPage(detailHtml)) {
          const fallback = buildListingInput(options.portal, result, emptyDetailFallback(), {
            source: "live",
            search: result,
            detail: null,
            detailStatus: "blocked"
          });

          if (!fallback.success || countRecoveredLiveFallbacksAsFailures) {
            failedDetails += 1;
            detailFailures.blocked += 1;
          }

          return fallback.success ? fallback.data : null;
        }

        if (options.looksNonListingPage(result.url, detailHtml)) {
          const fallback = buildListingInput(options.portal, result, emptyDetailFallback(), {
            source: "live",
            search: result,
            detail: null,
            detailStatus: "invalid"
          });

          if (!fallback.success || countRecoveredLiveFallbacksAsFailures) {
            failedDetails += 1;
            detailFailures.invalid += 1;
          }

          return fallback.success ? fallback.data : null;
        }

        const detail = options.parseDetail(detailHtml, result.url);
        const parsed = buildListingInput(options.portal, result, detail, {
          source: "live",
          search: result,
          detail
        });

        if (!parsed.success) {
          const fallback = buildListingInput(options.portal, result, emptyDetailFallback(), {
            source: "live",
            search: result,
            detail: null,
            detailStatus: "invalid"
          });

          if (!fallback.success || countRecoveredLiveFallbacksAsFailures) {
            failedDetails += 1;
            detailFailures.invalid += 1;
          }

          return fallback.success ? fallback.data : null;
        }

        return parsed.data;
      } catch (error) {
        const fallback = buildListingInput(options.portal, result, emptyDetailFallback(), {
          source: "live",
          search: result,
          detail: null,
          detailStatus: "error",
          detailError: error instanceof Error ? error.message : "Unknown error"
        });

        if (!fallback.success || countRecoveredLiveFallbacksAsFailures) {
          failedDetails += 1;
          detailFailures.error += 1;
        }

        return fallback.success ? fallback.data : null;
      } finally {
        await detailPage.close();
      }
    });

    const storageState = await context.storageState();

    return buildResult(
      {
        listings: listingResults.filter((listing): listing is ListingUpsertInput => Boolean(listing)),
        listingsFound: searchResults.length,
        failedDetails,
        detailFailures
      },
      "live",
      "session_valid",
      storageState as SourceSessionState,
      {
        validatedAt: new Date()
      }
    );
  } finally {
    await context.close();
    await browser.close();
  }
}

export async function scrapePortalWithSharedEngine(options: PortalScraperOptions) {
  return options.enableLiveBrowser ? scrapeLive(options) : scrapeFixtures(options);
}
