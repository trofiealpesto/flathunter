import { buildStealthInitScript } from "@flathunter/shared";
import { chromium } from "@playwright/test";

import type { SourceSessionState } from "./types";

export type BrowserLauncher = typeof chromium.launch;

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function jitterDelay(minMs: number, maxMs: number) {
  const duration = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return sleep(duration);
}

export async function withRetry<T>(task: () => Promise<T>, attempts: number, delayMs: number) {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;

      if (attempt < attempts - 1) {
        await sleep(delayMs * (attempt + 1));
      }
    }
  }

  throw lastError;
}

export async function mapWithConcurrency<T, TResult>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<TResult>
) {
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex] as T, currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () => runWorker()));

  return results;
}

export async function launchScraperContext(options?: {
  browserLauncher?: BrowserLauncher;
  proxyUrl?: string;
  storageState?: SourceSessionState | null;
  blockedResourceTypes?: Array<"image" | "media" | "font">;
}) {
  const browserLauncher = options?.browserLauncher ?? chromium.launch.bind(chromium);
  const browser = await browserLauncher({
    headless: true,
    proxy: options?.proxyUrl
      ? {
          server: options.proxyUrl
        }
      : undefined
  });
  const context = await browser.newContext({
    storageState: options?.storageState ?? undefined,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    viewport: {
      width: 1440,
      height: 900
    },
    colorScheme: "light",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      "Accept-Language": "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
      DNT: "1",
      "Upgrade-Insecure-Requests": "1"
    }
  });

  await context.addInitScript(buildStealthInitScript());

  const blockedResourceTypes = options?.blockedResourceTypes ?? ["image", "media", "font"];

  if (blockedResourceTypes.length > 0) {
    await context.route("**/*", async (route) => {
      const resourceType = route.request().resourceType();

      if (blockedResourceTypes.includes(resourceType as "image" | "media" | "font")) {
        await route.abort();
        return;
      }

      await route.continue();
    });
  }

  return {
    browser,
    context
  };
}

export async function scrapePageHtml(page: { goto: Function; waitForLoadState: Function; content: Function }, url: string, timeoutMs: number) {
  await page.goto(url, {
    waitUntil: "commit",
    timeout: timeoutMs
  });
  await page.waitForLoadState("domcontentloaded", {
    timeout: Math.min(timeoutMs, 7_500)
  }).catch(() => {});
  await page.waitForLoadState("networkidle", {
    timeout: 1500
  }).catch(() => {});
  return page.content();
}
