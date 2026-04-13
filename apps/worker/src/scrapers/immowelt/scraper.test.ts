import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { scrapePortalWithSharedEngine } from "../shared/engine";
import { parseImmoweltDetail, parseImmoweltSearchResults } from "./parser";
import { looksBlockedImmoweltPage, looksNonListingImmoweltPage } from "./scraper";

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
    <article data-test="listing-card" data-id="broken-999">
      <a data-test="listing-url" href="/expose/broken-999">Open</a>
      <h2 data-test="listing-title">Broken listing</h2>
    </article>
  </section>
`;

const detailHtml = `
  <section>
    <div data-test="description">Long-term apartment with balcony</div>
    <img src="https://static.immowelt.de/images/detail-1.jpg" />
    <span data-test="city">Berlin</span>
    <span data-test="district">Mitte</span>
    <span data-test="rentCold">1.400 EUR</span>
    <span data-test="rentWarm">1.650 EUR</span>
    <span data-test="sizeSqm">74 m2</span>
    <span data-test="rooms">3.0</span>
    <span data-attr="hasBalcony">yes</span>
  </section>
`;

const liveSearchHtml = `
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
      <div>Friedenauer Höhe 6, Friedenau, Berlin (12159)</div>
    </div>
  </section>
`;

const tempDirs: string[] = [];

async function createFixturesDir() {
  const fixturesDir = await mkdtemp(path.join(os.tmpdir(), "flathunter-immowelt-"));
  tempDirs.push(fixturesDir);
  await writeFile(path.join(fixturesDir, "search.html"), searchHtml, "utf8");
  await writeFile(path.join(fixturesDir, "detail-1.html"), detailHtml, "utf8");
  return fixturesDir;
}

function createImmoweltOptions(overrides: Partial<Parameters<typeof scrapePortalWithSharedEngine>[0]> = {}) {
  return {
    portal: "IMMOWELT" as const,
    searchUrl: "https://www.immowelt.de/liste/berlin/wohnungen/mieten",
    fixturesDir: "/tmp/unused",
    enableLiveBrowser: false,
    requestTimeoutMs: 20_000,
    maxDetailConcurrency: 2,
    maxRetries: 2,
    blockedResourceTypes: ["media", "font"] as ("image" | "media" | "font")[],
    parseSearchResults: parseImmoweltSearchResults,
    parseDetail: (html: string) => parseImmoweltDetail(html),
    looksBlockedPage: looksBlockedImmoweltPage,
    looksNonListingPage: looksNonListingImmoweltPage,
    countRecoveredLiveFallbacksAsFailures: false,
    ...overrides
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("scrapePortalWithSharedEngine for Immowelt", () => {
  it("returns partial results in fixture mode when some detail pages fail", async () => {
    const fixturesDir = await createFixturesDir();

    const result = await scrapePortalWithSharedEngine(
      createImmoweltOptions({
        fixturesDir
      })
    );

    expect(result.mode).toBe("fixture");
    expect(result.authStatus).toBe("ready");
    expect(result.listingsFound).toBe(2);
    expect(result.failedDetails).toBe(1);
    expect(result.detailFailures).toMatchObject({
      blocked: 0,
      invalid: 0,
      error: 1
    });
    expect(result.listings).toHaveLength(2);
    expect(result.listings[0]).toMatchObject({
      portalListingId: "abc-123",
      rawPayload: {
        search: {
          coverImageUrl: "https://static.immowelt.de/images/search-1.jpg"
        },
        detail: {
          coverImageUrl: "https://static.immowelt.de/images/detail-1.jpg"
        }
      }
    });
  });

  it("returns challenge_required when the live search page is blocked or unavailable", async () => {
    const browser = {
      newContext: vi.fn().mockResolvedValue({
        addInitScript: vi.fn(),
        route: vi.fn(),
        newPage: vi.fn().mockResolvedValue({
          goto: vi.fn(),
          waitForLoadState: vi.fn().mockResolvedValue(undefined),
          content: vi.fn().mockResolvedValue(`
            <html>
              <body>
                <div>Wir haben technische Schwierigkeiten</div>
                <div>Bitte versuche es in ein paar Minuten erneut.</div>
              </body>
            </html>
          `),
          close: vi.fn()
        }),
        storageState: vi.fn().mockResolvedValue({
          cookies: [],
          origins: []
        }),
        close: vi.fn()
      }),
      close: vi.fn()
    };

    const result = await scrapePortalWithSharedEngine(
      createImmoweltOptions({
        enableLiveBrowser: true,
        browserLauncher: vi.fn().mockResolvedValue(browser) as never
      })
    );

    expect(result.mode).toBe("live");
    expect(result.authStatus).toBe("challenge_required");
    expect(result.listingsFound).toBe(0);
    expect(result.authError).toContain("blocked");
  });

  it("falls back to search-card data when detail pages are blocked", async () => {
    const firstPage = {
      goto: vi.fn(),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      content: vi.fn().mockResolvedValue(liveSearchHtml),
      close: vi.fn()
    };

    const detailPage = {
      goto: vi.fn(),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      content: vi
        .fn()
        .mockResolvedValue(`<html><body><p>Please enable JS and disable any ad blocker</p></body></html>`),
      close: vi.fn()
    };

    const context = {
      addInitScript: vi.fn(),
      route: vi.fn(),
      newPage: vi.fn().mockResolvedValueOnce(firstPage).mockResolvedValueOnce(detailPage),
      storageState: vi.fn().mockResolvedValue({
        cookies: [],
        origins: []
      }),
      close: vi.fn()
    };

    const browser = {
      newContext: vi.fn().mockResolvedValue(context),
      close: vi.fn()
    };

    const result = await scrapePortalWithSharedEngine(
      createImmoweltOptions({
        enableLiveBrowser: true,
        browserLauncher: vi.fn().mockResolvedValue(browser) as never
      })
    );

    expect(result.mode).toBe("live");
    expect(result.authStatus).toBe("session_valid");
    expect(result.listingsFound).toBe(1);
    expect(result.failedDetails).toBe(0);
    expect(result.detailFailures).toMatchObject({
      blocked: 0,
      invalid: 0,
      error: 0
    });
    expect(result.listings[0]).toMatchObject({
      portalListingId: "live-123",
      title: "Wohnung zur Miete",
      url: "https://www.immowelt.de/expose/live-123",
      rawPayload: {
        search: {
          coverImageUrl: "https://static.immowelt.de/images/live-123.jpg"
        },
        detailStatus: "blocked"
      }
    });
  });
});
