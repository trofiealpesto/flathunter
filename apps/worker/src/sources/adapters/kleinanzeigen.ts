import path from "node:path";
import { fileURLToPath } from "node:url";

import { deleteInvalidLiveListingsByCanonicalPrefix, deleteListingsBySourceMode } from "@flathunter/db";

import { parseKleinanzeigenDetail, parseKleinanzeigenSearchResults, looksBlockedKleinanzeigenPage, looksNonListingKleinanzeigenPage } from "../../scrapers/kleinanzeigen/parser";
import { scrapePortalWithSharedEngine } from "../../scrapers/shared/engine";
import type { SourceAdapter } from "../types";

function fixturesDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/kleinanzeigen");
}

export const kleinanzeigenAdapter: SourceAdapter = {
  portal: "KLEINANZEIGEN",
  capabilities: {
    supportsLogin: true,
    supportsCaptchaSolver: true,
    supportsDetailFallback: true,
    sourceKind: "scraping",
    readiness: "experimental",
    cloudCompatible: false,
    requiresAuthSetup: true,
    setupHint: "Experimental scraping source. Keep it disabled until authentication and reliability are proven on your session."
  },
  defaultSource(settings) {
    return {
      searchUrl: "https://www.kleinanzeigen.de/s-wohnung-mieten/berlin/c203l3331",
      searchParams: {
        city: settings.search.city,
        districts: settings.search.districts,
        category: "wohnung-mieten"
      }
    };
  },
  async scrape(context) {
    return scrapePortalWithSharedEngine({
      portal: "KLEINANZEIGEN",
      searchUrl: context.searchUrl,
      fixturesDir: fixturesDir(),
      enableLiveBrowser: !context.scrapeWithFixtures,
      requestTimeoutMs: 20_000,
      maxDetailConcurrency: 2,
      maxRetries: 2,
      proxyUrl: context.env.SCRAPER_PROXY_URL,
      sessionState: context.sessionState,
      credentials: context.credentials,
      parseSearchResults: parseKleinanzeigenSearchResults,
      parseDetail: parseKleinanzeigenDetail,
      looksBlockedPage: looksBlockedKleinanzeigenPage,
      looksNonListingPage: looksNonListingKleinanzeigenPage
    });
  },
  async cleanup({ db, portal, runMode, listingsFound }) {
    if (runMode !== "live" || listingsFound <= 0) {
      return;
    }

    await deleteInvalidLiveListingsByCanonicalPrefix(db, portal, "https://www.kleinanzeigen.de/s-anzeige/");
    await deleteListingsBySourceMode(db, portal, "fixture");
  }
};
