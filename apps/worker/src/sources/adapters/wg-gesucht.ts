import path from "node:path";
import { fileURLToPath } from "node:url";

import { deleteInvalidLiveListingsByCanonicalPrefix, deleteListingsBySourceMode } from "@flathunter/db";

import { scrapePortalWithSharedEngine } from "../../scrapers/shared/engine";
import { looksBlockedWgGesuchtPage, looksNonListingWgGesuchtPage, parseWgGesuchtDetail, parseWgGesuchtSearchResults } from "../../scrapers/wg-gesucht/parser";
import type { SourceAdapter } from "../types";

function fixturesDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/wg-gesucht");
}

export const wgGesuchtAdapter: SourceAdapter = {
  portal: "WG_GESUCHT",
  capabilities: {
    supportsLogin: true,
    supportsCaptchaSolver: true,
    supportsDetailFallback: true,
    sourceKind: "scraping",
    readiness: "secondary",
    cloudCompatible: false,
    requiresAuthSetup: true,
    setupHint: "Secondary scraping source. Use a normal portal account; no developer API access is expected."
  },
  defaultSource(settings) {
    return {
      searchUrl: "https://www.wg-gesucht.de/wohnungen-in-Berlin.8.2.1.0.html",
      searchParams: {
        city: settings.search.city,
        districts: settings.search.districts,
        scope: "whole_flat"
      }
    };
  },
  async scrape(context) {
    return scrapePortalWithSharedEngine({
      portal: "WG_GESUCHT",
      searchUrl: context.searchUrl,
      fixturesDir: fixturesDir(),
      enableLiveBrowser: !context.scrapeWithFixtures,
      requestTimeoutMs: 45_000,
      maxDetailConcurrency: 2,
      maxRetries: 2,
      proxyUrl: context.env.SCRAPER_PROXY_URL,
      sessionState: context.sessionState,
      credentials: context.credentials,
      parseSearchResults: parseWgGesuchtSearchResults,
      parseDetail: parseWgGesuchtDetail,
      looksBlockedPage: looksBlockedWgGesuchtPage,
      looksNonListingPage: looksNonListingWgGesuchtPage
    });
  },
  async cleanup({ db, portal, runMode, listingsFound }) {
    if (runMode !== "live" || listingsFound <= 0) {
      return;
    }

    await deleteInvalidLiveListingsByCanonicalPrefix(db, portal, "https://www.wg-gesucht.de/wohnungen-");
    await deleteListingsBySourceMode(db, portal, "fixture");
  }
};
