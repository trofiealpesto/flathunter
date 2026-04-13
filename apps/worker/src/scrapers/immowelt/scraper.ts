import type { WorkerEnv } from "../../config";

export function looksBlockedImmoweltPage(html: string) {
  const normalized = html.toLowerCase();

  return [
    "wir haben technische schwierigkeiten",
    "bitte versuche es in ein paar minuten erneut",
    "technical difficulties",
    "please enable js and disable any ad blocker",
    "captcha-delivery.com",
    "captcha",
    "access denied",
    "forbidden"
  ].some((needle) => normalized.includes(needle));
}

export function looksNonListingImmoweltPage(url: string, html: string) {
  const normalizedUrl = url.toLowerCase();
  const normalizedHtml = html.toLowerCase();

  if (!/\/expose\//.test(normalizedUrl)) {
    return true;
  }

  return [
    "app store",
    "google play store",
    "jetzt unsere app",
    "download immowelt",
    "please enable js and disable any ad blocker"
  ].some((needle) => normalizedHtml.includes(needle));
}

export function resolveImmoweltSearchUrl(env: WorkerEnv) {
  return env.IMMOWELT_SEARCH_URL;
}

export function isImmoweltLiveBrowserEnabled(env: WorkerEnv, scrapeWithFixtures: boolean) {
  return env.IMMOWELT_ENABLE_LIVE_BROWSER && !scrapeWithFixtures;
}
