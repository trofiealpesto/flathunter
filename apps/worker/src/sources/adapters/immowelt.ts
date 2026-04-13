import path from "node:path";
import { fileURLToPath } from "node:url";

import { deleteInvalidLiveListingsByCanonicalPrefix, deleteListingsBySourceMode } from "@flathunter/db";

import { parseImmoweltDetail, parseImmoweltSearchResults } from "../../scrapers/immowelt/parser";
import {
  isImmoweltLiveBrowserEnabled,
  looksBlockedImmoweltPage,
  looksNonListingImmoweltPage,
  resolveImmoweltSearchUrl
} from "../../scrapers/immowelt/scraper";
import { scrapePortalWithSharedEngine } from "../../scrapers/shared/engine";
import type { SourceAdapter } from "../types";

function fixturesDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/immowelt");
}

export const immoweltAdapter: SourceAdapter = {
  portal: "IMMOWELT",
  capabilities: {
    supportsLogin: true,
    supportsCaptchaSolver: true,
    supportsDetailFallback: true,
    sourceKind: "scraping",
    readiness: "primary",
    cloudCompatible: true,
    requiresAuthSetup: false,
    setupHint: "Primary scraping source. No developer API or partner account is required."
  },
  defaultSource(settings, env) {
    return {
      searchUrl: settings.search.immoweltSearchUrl || resolveImmoweltSearchUrl(env),
      searchParams: {
        city: settings.search.city,
        districts: settings.search.districts
      }
    };
  },
  async scrape(context) {
    return scrapePortalWithSharedEngine({
      portal: "IMMOWELT",
      searchUrl: context.searchUrl,
      fixturesDir: fixturesDir(),
      enableLiveBrowser: isImmoweltLiveBrowserEnabled(context.env, context.scrapeWithFixtures),
      requestTimeoutMs: 20_000,
      maxDetailConcurrency: 2,
      maxRetries: 2,
      proxyUrl: context.env.SCRAPER_PROXY_URL,
      blockedResourceTypes: ["media", "font"],
      sessionState: context.sessionState,
      credentials: context.credentials,
      parseSearchResults: parseImmoweltSearchResults,
      parseDetail: (html) => parseImmoweltDetail(html),
      looksBlockedPage: looksBlockedImmoweltPage,
      looksNonListingPage: looksNonListingImmoweltPage,
      countRecoveredLiveFallbacksAsFailures: false
    });
  },
  async cleanup({ db, portal, runMode, listingsFound }) {
    if (runMode !== "live" || listingsFound <= 0) {
      return;
    }

    await deleteInvalidLiveListingsByCanonicalPrefix(db, portal, "https://www.immowelt.de/expose/");
    await deleteListingsBySourceMode(db, portal, "fixture");
  }
};
