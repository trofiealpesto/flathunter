# Flathunter – Scraper Reliability Implementation Plan

## Goal

Make scraping work reliably for **Immowelt** (primary), **WG-Gesucht** (secondary), and **Kleinanzeigen** (secondary) — without a paid proxy, without touching ImmoScout24.

---

## Portals in scope

| Portal | Strategy | Requires credentials? |
|---|---|---|
| **Immowelt** | Anonymous scraping + stealth | No |
| **WG-Gesucht** | Session-based scraping (existing manual bootstrap) | Yes |
| **Kleinanzeigen** | Session-based scraping (existing manual bootstrap) | Yes |
| ~~ImmoScout24~~ | **Removed** | — |

---

## Phase 1 — Comprehensive Browser Stealth

### Why

Both scraping paths (`apps/worker/src/sources/browser.ts` and `apps/api/src/lib/source-auth.ts`) apply a minimal 4-line `addInitScript` that only patches `navigator.webdriver`, `navigator.languages`, `navigator.platform`, and `window.chrome`. Anti-bot systems (Incapsula on Immowelt, Cloudflare on Kleinanzeigen) check many more signals. This phase makes both browser contexts look like a real Chromium user.

### 1.1 — Create `apps/worker/src/sources/stealth.ts` (NEW FILE)

This exports a single function that returns the complete init script. Using a shared export ensures the worker's and the api's browser contexts are always in sync.

```ts
/**
 * Returns a self-contained JS function to be passed to Playwright's
 * context.addInitScript(). It patches all signals commonly used by
 * Incapsula, Cloudflare, and similar bot-detection systems.
 *
 * Keep this as a plain inline function — no imports — because
 * addInitScript serialises it and runs it in the browser sandbox.
 */
export function buildStealthInitScript(): () => void {
  return () => {
    // 1. Remove the automation flag
    Object.defineProperty(navigator, "webdriver", {
      configurable: true,
      enumerable: true,
      get: () => undefined,
    });

    // 2. Realistic plugin list (Chromium normally has 3 built-in plugins)
    const makeFakePlugin = (name: string, filename: string, description: string) => {
      const plugin = Object.create(Plugin.prototype);
      Object.defineProperties(plugin, {
        name: { value: name, enumerable: true },
        filename: { value: filename, enumerable: true },
        description: { value: description, enumerable: true },
        length: { value: 0, enumerable: true },
      });
      return plugin;
    };
    const fakePlugins = [
      makeFakePlugin("PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
      makeFakePlugin("Chrome PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
      makeFakePlugin("Chromium PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
    ];
    Object.defineProperty(navigator, "plugins", {
      configurable: true,
      enumerable: true,
      get: () => {
        const arr = [...fakePlugins] as unknown as PluginArray;
        Object.setPrototypeOf(arr, PluginArray.prototype);
        return arr;
      },
    });

    // 3. Languages (overwrite, don't just redefine)
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      enumerable: true,
      get: () => ["de-DE", "de", "en-US", "en"],
    });

    // 4. Hardware concurrency and device memory (appear as a real workstation)
    Object.defineProperty(navigator, "hardwareConcurrency", {
      configurable: true,
      get: () => 8,
    });
    try {
      Object.defineProperty(navigator, "deviceMemory", {
        configurable: true,
        get: () => 8,
      });
    } catch { /* not available in all contexts */ }

    // 5. Full chrome globals (current approach only sets window.chrome.runtime)
    // @ts-expect-error intentional global shim
    window.chrome = {
      app: {
        isInstalled: false,
        // @ts-expect-error shim
        InstallState: { DISABLED: "disabled", INSTALLED: "installed", NOT_INSTALLED: "not_installed" },
        // @ts-expect-error shim
        RunningState: { CANNOT_RUN: "cannot_run", READY_TO_RUN: "ready_to_run", RUNNING: "running" },
      },
      runtime: {
        // @ts-expect-error shim
        PlatformOs: { MAC: "mac", WIN: "win", ANDROID: "android", CROS: "cros", LINUX: "linux" },
        // @ts-expect-error shim
        PlatformArch: { ARM: "arm", X86_32: "x86-32", X86_64: "x86-64" },
        // @ts-expect-error shim
        OnInstalledReason: { INSTALL: "install", UPDATE: "update", CHROME_UPDATE: "chrome_update" },
      },
      // @ts-expect-error shim
      loadTimes: () => ({}),
      // @ts-expect-error shim
      csi: () => ({}),
    };

    // 6. Permissions API — bot checks often probe notification state via this
    if (window.Permissions?.prototype?.query) {
      const originalQuery = window.Permissions.prototype.query.bind(window.Permissions.prototype);
      window.Permissions.prototype.query = (parameters: any) => {
        if (parameters?.name === "notifications") {
          return Promise.resolve(
            Object.assign(Object.create(PermissionStatus.prototype), {
              state: (window.Notification as any)?.permission ?? "default",
              onchange: null,
            })
          );
        }
        return originalQuery(parameters);
      };
    }

    // 7. Spoof outer dimensions to match viewport (real browsers have OS chrome)
    try {
      Object.defineProperty(window, "outerWidth", { configurable: true, get: () => window.innerWidth + 16 });
      Object.defineProperty(window, "outerHeight", { configurable: true, get: () => window.innerHeight + 88 });
    } catch { /* ignore */ }

    // 8. WebGL vendor — real Chrome on Mac reports Apple/Intel, not Mesa
    try {
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (param: number) {
        if (param === 37445) return "Apple Inc.";           // UNMASKED_VENDOR_WEBGL
        if (param === 37446) return "Apple M-series GPU";  // UNMASKED_RENDERER_WEBGL
        return getParameter.call(this, param);
      };
    } catch { /* WebGL may not be available in headless context */ }
  };
}
```

> **Important note for the agent**: the function body is serialised by Playwright and executed in the browser sandbox. It must be a plain inline function with no external references. The `@ts-expect-error` comments suppress TypeScript errors for browser globals not known to Node.js. Do not import anything from outside the function.

---

### 1.2 — Update `apps/worker/src/sources/browser.ts`

**Goal**: Apply the stealth script and remove the old minimal patches.

#### Changes

In `launchScraperContext`, replace the existing `context.addInitScript(() => { ... })` block with:

```ts
import { buildStealthInitScript } from "./stealth";

// Inside launchScraperContext, after creating the context:
await context.addInitScript(buildStealthInitScript());
```

Remove the old `addInitScript` block entirely (the one that patches `navigator.webdriver`, `navigator.languages`, `navigator.platform`, `window.chrome`). The stealth script now covers all of these plus much more.

Also **keep the resource-blocking route** (`image`, `media`, `font` → abort) — it's a performance win and does not cause blocks in practice on Incapsula. If Immowelt blocks despite the stealth patches, removing the image abort is the first thing to try.

---

### 1.3 — Update `apps/api/src/lib/source-auth.ts`

The `configureContext` function in this file has the same minimal init script. Update it to use the same stealth function.

Since `apps/api` and `apps/worker` are separate apps, copy the stealth function inline rather than importing across app boundaries. Create a private copy at the top of `source-auth.ts`:

```ts
// In apps/api/src/lib/source-auth.ts — add near the top (before sourceAuthConfigs):
function buildStealthInitScript(): () => void {
  // Paste the EXACT same function body from apps/worker/src/sources/stealth.ts
  // This is intentional duplication — they must stay in sync.
  return () => { /* ... same as above ... */ };
}
```

Then in `configureContext`, replace the old `addInitScript` block:

```ts
async function configureContext(context: BrowserContext) {
  await context.route("**/*", async (route) => {
    const resourceType = route.request().resourceType();
    if (resourceType === "image" || resourceType === "media" || resourceType === "font") {
      await route.abort();
      return;
    }
    await route.continue();
  });

  // Replace the old minimal addInitScript block with this:
  await context.addInitScript(buildStealthInitScript());
}
```

> **Note**: Do NOT import from `apps/worker` into `apps/api`. They are separate app packages. Manual duplication of this one function is intentional and documented.

---

## Phase 2 — Human-like Delays in the Shared Engine

### Why

Currently `mapWithConcurrency` fires all 3 detail pages simultaneously and with no delay between new page loads. This timing pattern is obvious to bot-detection systems. Real users navigate pages sequentially with variable delays.

### 2.1 — Update `apps/worker/src/sources/browser.ts`

Add a `jitterDelay` utility (can be exported alongside `withRetry` and `mapWithConcurrency`):

```ts
export function jitterDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

### 2.2 — Update `apps/worker/src/scrapers/shared/engine.ts`

Import `jitterDelay` from `../../sources/browser`. Add a delay before each detail page fetch inside `scrapeLive`:

```ts
import { launchScraperContext, mapWithConcurrency, scrapePageHtml, withRetry, jitterDelay } from "../../sources/browser";

// Inside the mapWithConcurrency callback in scrapeLive, before opening the detail page:
const listingResults = await mapWithConcurrency(searchResults, maxDetailConcurrency, async (result, index) => {
  // Stagger requests: even small delays (500–2000ms) look natural and prevent burst patterns
  if (index > 0) {
    await jitterDelay(500, 2000);
  }

  const detailPage = await context.newPage();
  // ... rest unchanged
});
```

Also change the **default** for `maxDetailConcurrency` in the `PortalScraperOptions` defaults from 3 → **2**. This means at most 2 simultaneous detail requests, which is more realistic.

```ts
// In the scrapeLive function:
const maxDetailConcurrency = options.maxDetailConcurrency ?? 2; // was 3
```

---

## Phase 3 — Refactor Immowelt to Use the Shared Engine

### Why

`apps/worker/src/scrapers/immowelt/scraper.ts` is a 366-line standalone reimplementation of the shared engine. It has its own `withRetry`, `mapWithConcurrency`, `scrapePageHtml`, and its own live/fixture branching logic. When Phase 2 added jitter delays to the shared engine, Immowelt would not benefit. All changes need to be applied twice. Fix this now.

### 3.1 — Simplify `apps/worker/src/scrapers/immowelt/scraper.ts`

Remove: `scrapeImmoweltLive`, `scrapeImmoweltFixtures`, `scrapeImmowelt`, and all the duplicate utilities (`withRetry`, `mapWithConcurrency`, `scrapePageHtml`, `createEmptyDetailFallback`, `looksNonListingImmoweltPage`, `buildListingInput`, `sleep`).

Keep and export only:

```ts
// apps/worker/src/scrapers/immowelt/scraper.ts (after refactor)

import { type Portal } from "@flathunter/shared";
import type { WorkerEnv } from "../../config";

export function looksBlockedImmoweltPage(html: string): boolean {
  const normalized = html.toLowerCase();
  return [
    "wir haben technische schwierigkeiten",
    "bitte versuche es in ein paar minuten erneut",
    "technical difficulties",
    "please enable js and disable any ad blocker",
    "captcha-delivery.com",
    "captcha",
    "access denied",
    "forbidden",
  ].some((needle) => normalized.includes(needle));
}

export function looksNonListingImmoweltPage(url: string, html: string): boolean {
  const normalizedUrl = url.toLowerCase();
  const normalizedHtml = html.toLowerCase();
  if (!/\/expose\//.test(normalizedUrl)) return true;
  return [
    "app store",
    "google play store",
    "jetzt unsere app",
    "download immowelt",
    "please enable js and disable any ad blocker",
  ].some((needle) => normalizedHtml.includes(needle));
}

export function resolveImmoweltSearchUrl(env: WorkerEnv): string {
  return env.IMMOWELT_SEARCH_URL;
}

export function isImmoweltLiveBrowserEnabled(env: WorkerEnv, scrapeWithFixtures: boolean): boolean {
  return env.IMMOWELT_ENABLE_LIVE_BROWSER && !scrapeWithFixtures;
}
```

Delete the `ImmoweltScrapeResult` and `ImmoweltScrapeOptions` types — they are no longer used externally.

Keep `ImmoweltScrapeOptions` type if `resolveImmoweltScrapeOptions` is used externally, otherwise remove it.

### 3.2 — Update `apps/worker/src/sources/adapters/immowelt.ts`

Replace the old `scrapeImmowelt` call with `scrapePortalWithSharedEngine`:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";

import { deleteInvalidLiveListingsByCanonicalPrefix, deleteListingsBySourceMode } from "@flathunter/db";

import { scrapePortalWithSharedEngine } from "../../scrapers/shared/engine";
import {
  looksBlockedImmoweltPage,
  looksNonListingImmoweltPage,
  isImmoweltLiveBrowserEnabled,
  resolveImmoweltSearchUrl,
} from "../../scrapers/immowelt/scraper";
import { parseImmoweltDetail, parseImmoweltSearchResults } from "../../scrapers/immowelt/parser";
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
    requiresAuthSetup: false,
    setupHint: "Primary scraping source. No developer API or partner account is required.",
  },
  defaultSource(settings, env) {
    return {
      searchUrl: settings.search.immoweltSearchUrl || resolveImmoweltSearchUrl(env),
      searchParams: {
        city: settings.search.city,
        districts: settings.search.districts,
      },
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
      sessionState: context.sessionState,
      credentials: context.credentials,
      parseSearchResults: parseImmoweltSearchResults,
      parseDetail: (html) => parseImmoweltDetail(html),
      looksBlockedPage: looksBlockedImmoweltPage,
      looksNonListingPage: looksNonListingImmoweltPage,
    });
  },
  async cleanup({ db, portal, runMode, listingsFound }) {
    if (runMode !== "live" || listingsFound <= 0) return;
    await deleteInvalidLiveListingsByCanonicalPrefix(db, portal, "https://www.immowelt.de/expose/");
    await deleteListingsBySourceMode(db, portal, "fixture");
  },
};
```

> **Note**: The shared engine returns a full `SourceScrapeResult` (with `authStatus`, `sessionState`, etc.) natively, so the adapter no longer needs to manually construct those fields.

---

## Phase 4 — Fixture HTML Capture Script

### Why

All fixture directories (`fixtures/immowelt`, `fixtures/wg-gesucht`, `fixtures/kleinanzeigen`) are empty. Without fixture HTML files, fixture mode produces zero listings and parser tests that depend on real-world HTML don't exist. Capture real HTMl once after a successful live scrape so future development and testing doesn't depend on hitting live sites.

### 4.1 — Create `scripts/capture-fixtures.ts` (NEW FILE)

```ts
#!/usr/bin/env node
/**
 * Usage: pnpm tsx scripts/capture-fixtures.ts --portal immowelt
 *
 * Runs a single live browser pass against the target portal's search URL,
 * saves the search HTML and the first N detail HTMLs to the fixtures
 * directory so fixture mode (and parser unit tests) work offline.
 *
 * Respects the same .env file as the worker.
 */
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { launchScraperContext, scrapePageHtml } from "../apps/worker/src/sources/browser";

const PORTALS = {
  immowelt: {
    searchUrl: "https://www.immowelt.de/liste/berlin/wohnungen/mieten?sort=relevance&sd=DESC",
    fixturesDir: "../apps/worker/src/fixtures/immowelt",
    extractDetailUrls: (html: string): string[] => {
      // Extract the first 3 /expose/ URLs from the search HTML
      const matches = [...html.matchAll(/href="(https:\/\/www\.immowelt\.de\/expose\/[^"?#]+)"/g)];
      return [...new Set(matches.map((m) => m[1]))].slice(0, 3);
    },
  },
  "wg-gesucht": {
    searchUrl: "https://www.wg-gesucht.de/wohnungen-in-Berlin.8.2.1.0.html",
    fixturesDir: "../apps/worker/src/fixtures/wg-gesucht",
    extractDetailUrls: (html: string): string[] => {
      const matches = [...html.matchAll(/href="(\/wohnungen?-in-[^"?#]+\.html)"/g)];
      return [...new Set(matches.map((m) => `https://www.wg-gesucht.de${m[1]}`))]
        .filter((u) => /\.\d+\.html$/.test(u))
        .slice(0, 3);
    },
  },
  kleinanzeigen: {
    searchUrl: "https://www.kleinanzeigen.de/s-wohnung-mieten/berlin/c203l3331",
    fixturesDir: "../apps/worker/src/fixtures/kleinanzeigen",
    extractDetailUrls: (html: string): string[] => {
      const matches = [...html.matchAll(/href="(\/s-anzeige\/[^"?#]+\/\d+-\d+-\d+)"/g)];
      return [...new Set(matches.map((m) => `https://www.kleinanzeigen.de${m[1]}`))].slice(0, 3);
    },
  },
} as const;

async function main() {
  const portalArg = process.argv.find((_, i, a) => a[i - 1] === "--portal");
  if (!portalArg || !(portalArg in PORTALS)) {
    console.error(`Usage: pnpm tsx scripts/capture-fixtures.ts --portal <${Object.keys(PORTALS).join("|")}>`);
    process.exit(1);
  }

  const config = PORTALS[portalArg as keyof typeof PORTALS];
  const rootDir = path.dirname(fileURLToPath(import.meta.url));
  const fixturesDir = path.resolve(rootDir, config.fixturesDir);

  await fs.mkdir(fixturesDir, { recursive: true });

  console.log(`Launching browser for ${portalArg}...`);
  const { browser, context } = await launchScraperContext();

  try {
    const searchPage = await context.newPage();
    console.log(`Fetching search page: ${config.searchUrl}`);
    const searchHtml = await scrapePageHtml(searchPage, config.searchUrl, 30_000);
    await fs.writeFile(path.join(fixturesDir, "search.html"), searchHtml, "utf8");
    console.log(`Saved: search.html (${(searchHtml.length / 1024).toFixed(0)} KB)`);
    await searchPage.close();

    const detailUrls = config.extractDetailUrls(searchHtml);
    console.log(`Found ${detailUrls.length} detail URLs to capture`);

    for (const [i, url] of detailUrls.entries()) {
      const detailPage = await context.newPage();
      console.log(`Fetching detail ${i + 1}: ${url}`);
      try {
        const detailHtml = await scrapePageHtml(detailPage, url, 30_000);
        await fs.writeFile(path.join(fixturesDir, `detail-${i + 1}.html`), detailHtml, "utf8");
        console.log(`Saved: detail-${i + 1}.html (${(detailHtml.length / 1024).toFixed(0)} KB)`);
      } catch (err) {
        console.error(`Failed to fetch detail ${i + 1}: ${err instanceof Error ? err.message : err}`);
      } finally {
        await detailPage.close();
      }
      // Small delay between detail fetches even during capture
      await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1000));
    }

    console.log(`\nDone. Fixtures saved to: ${fixturesDir}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
```

Add a `capture-fixtures` script to the root `package.json`:

```json
"scripts": {
  "capture-fixtures": "tsx scripts/capture-fixtures.ts"
}
```

> **Usage** after deployment:
> ```bash
> pnpm capture-fixtures --portal immowelt
> pnpm capture-fixtures --portal wg-gesucht
> pnpm capture-fixtures --portal kleinanzeigen
> ```
> Run this once against live sites. Commit the resulting HTML files. From then on, `settings.runtime.scrapeWithFixtures = true` gives deterministic offline test runs.

---

## Phase 5 — Disable ImmoScout24

ImmoScout24 uses DataDome, a premium anti-bot system that is effectively impossible to bypass without a paid residential proxy + CAPTCHA solving service. Remove it from the active portal set entirely.

### 5.1 — Update `apps/worker/src/sources/registry.ts`

Remove `immoscout24Adapter` from the `sourceAdapters` array and from the import:

```ts
// BEFORE
import { immoscout24Adapter } from "./adapters/immoscout24";
export const sourceAdapters = [immoweltAdapter, immoscout24Adapter, wgGesuchtAdapter, kleinanzeigenAdapter] as const;

// AFTER
export const sourceAdapters = [immoweltAdapter, wgGesuchtAdapter, kleinanzeigenAdapter] as const;
// Remove the immoscout24Adapter import line entirely
```

> Leave the `IMMOSCOUT24` portal value in the `portals` const array in `packages/shared/src/listings.ts` — it is needed for existing DB rows and schema migrations. Just stop registering an adapter for it.

### 5.2 — Update `portalsDisabledUntilAuth` in `registry.ts`

Also remove `"IMMOSCOUT24"` from the `portalsDisabledUntilAuth` set since it's no longer registered. Remove `"KLEINANZEIGEN"` from this set too — it is already managed correctly once credentials are saved via the bootstrap flow.

```ts
// BEFORE
const portalsDisabledUntilAuth = new Set<Portal>(["IMMOSCOUT24", "WG_GESUCHT", "KLEINANZEIGEN"]);

// AFTER
const portalsDisabledUntilAuth = new Set<Portal>(["WG_GESUCHT", "KLEINANZEIGEN"]);
```

---

## Phase 6 — Operating WG-Gesucht and Kleinanzeigen

These two portals already have a complete login bootstrap flow. After the stealth hardening in Phase 1, the flow should work as documented here.

### How to bootstrap credentials (via the existing UI)

1. Make sure the API is running locally with a graphical session (i.e., not in a headless shell — it will open a real browser window).
2. In the web UI, go to **Sources** → select **WG-Gesucht** (or **Kleinanzeigen**).
3. Enter your portal username and password in the credentials form and click **Save credentials**.
4. Click **Start browser session**. This calls `POST /api/sources/WG_GESUCHT/auth/bootstrap/start`, which opens a real (headless: false) Chromium window with the stealth context.
5. Complete any login form or CAPTCHA challenge manually in that window.
6. Click **Save browser session** in the UI. This calls `POST /api/sources/WG_GESUCHT/auth/bootstrap/finish`, which captures the `storageState` (cookies + localStorage) and stores it encrypted in the DB.
7. The source is now `session_valid`. Enable it in the Sources page.
8. On the next worker run, WG-Gesucht will use the stored session to scrape without re-authenticating.

### Session expiry

WG-Gesucht and Kleinanzeigen sessions typically last 7–30 days. When the worker detects `session_expired`, it will disable the source automatically. Repeat the bootstrap flow to renew it. Add a reminder in your own workflow to refresh sessions monthly.

---

## Summary of all file changes

| File | Action | Phase |
|---|---|---|
| `apps/worker/src/sources/stealth.ts` | **NEW** — stealth init script | 1 |
| `apps/worker/src/sources/browser.ts` | Modify — apply stealth, add `jitterDelay` export | 1, 2 |
| `apps/api/src/lib/source-auth.ts` | Modify — apply stealth in `configureContext` | 1 |
| `apps/worker/src/scrapers/shared/engine.ts` | Modify — import and apply `jitterDelay`, reduce default concurrency to 2 | 2 |
| `apps/worker/src/scrapers/immowelt/scraper.ts` | Modify — remove duplicate live scraping logic, export helpers only | 3 |
| `apps/worker/src/sources/adapters/immowelt.ts` | Modify — use `scrapePortalWithSharedEngine` | 3 |
| `scripts/capture-fixtures.ts` | **NEW** — CLI to save live HTML as fixture files | 4 |
| `package.json` (root) | Modify — add `capture-fixtures` script | 4 |
| `apps/worker/src/sources/registry.ts` | Modify — remove ImmoScout24 adapter | 5 |

---

## What to do first after implementing

1. Run the test suite: `pnpm --filter @flathunter/worker test` — all existing tests must pass. The Immowelt scraper tests (`scraper.test.ts`) will need updating because `scrapeImmowelt` no longer exists directly; those tests should now invoke `scrapePortalWithSharedEngine` with the Immowelt parsers or be refactored to test parsers in isolation.

2. Run the fixture capture: `pnpm capture-fixtures --portal immowelt`. If it succeeds without a blocked page, stealth is working.

3. Enable live mode: set `IMMOWELT_ENABLE_LIVE_BROWSER=true` in `.env`, deploy the worker, and check the portal source run logs after one cycle.

4. If Immowelt still blocks: the next debugging step is to allow images to load (remove the `image` abort from the route filter in `browser.ts`) since Incapsula's JS evaluation may check whether images were fetched. This was intentionally left as a knob to pull.
