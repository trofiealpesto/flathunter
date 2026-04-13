import path from "node:path";
import { fileURLToPath } from "node:url";

import { deleteInvalidLiveListingsByCanonicalPrefix, deleteListingsBySourceMode } from "@flathunter/db";

import { parseImmoscout24Detail, parseImmoscout24SearchResults, looksBlockedImmoscout24Page, looksNonListingImmoscout24Page } from "../../scrapers/immoscout24/parser";
import { scrapePortalWithSharedEngine } from "../../scrapers/shared/engine";
import type { SourceAdapter } from "../types";

function fixturesDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/immoscout24");
}

export const immoscout24Adapter: SourceAdapter = {
  portal: "IMMOSCOUT24",
  capabilities: {
    supportsLogin: true,
    supportsCaptchaSolver: true,
    supportsDetailFallback: true,
    sourceKind: "scraping",
    readiness: "experimental",
    cloudCompatible: false,
    requiresAuthSetup: true,
    setupHint: "Experimental scraping source. Use a normal portal account and refresh the browser session before enabling it."
  },
  defaultSource(settings) {
    return {
      searchUrl: "https://www.immobilienscout24.de/Suche/de/berlin/berlin/wohnung-mieten",
      searchParams: {
        city: settings.search.city,
        districts: settings.search.districts,
        category: "wohnung-mieten"
      }
    };
  },
  async scrape(context) {
    return scrapePortalWithSharedEngine({
      portal: "IMMOSCOUT24",
      searchUrl: context.searchUrl,
      fixturesDir: fixturesDir(),
      enableLiveBrowser: !context.scrapeWithFixtures,
      requestTimeoutMs: 20_000,
      maxDetailConcurrency: 2,
      maxRetries: 1,
      proxyUrl: context.env.SCRAPER_PROXY_URL,
      sessionState: context.sessionState,
      credentials: context.credentials,
      parseSearchResults: parseImmoscout24SearchResults,
      parseDetail: (html) => parseImmoscout24Detail(html),
      looksBlockedPage: looksBlockedImmoscout24Page,
      looksNonListingPage: looksNonListingImmoscout24Page
    });
  },
  async cleanup({ db, portal, runMode, listingsFound }) {
    if (runMode !== "live" || listingsFound <= 0) {
      return;
    }

    await deleteInvalidLiveListingsByCanonicalPrefix(db, portal, "https://www.immobilienscout24.de/expose/");
    await deleteListingsBySourceMode(db, portal, "fixture");
  }
};
