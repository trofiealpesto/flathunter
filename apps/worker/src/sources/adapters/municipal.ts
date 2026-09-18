import { readFile } from "node:fs/promises";
import * as cheerio from "cheerio";
import { z } from "zod";
import {
  listingUpsertInputSchema,
  municipalSourceCapabilities,
  municipalSourceUrls,
  type ListingUpsertInput,
  type MunicipalPortal,
} from "@flathunter/shared";
import { normalizeReadableText, parseNumber } from "../../scrapers/shared/utils";
import type { SourceAdapter, SourceAdapterContext, SourceScrapeResult } from "../types";

const MAX_PAGES = 30;

async function fixture(name: string) {
  try {
    return await readFile(new URL(`../../fixtures/${name}`, import.meta.url), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // tsup emits the adapter in dist; Docker retains the source fixtures.
    return readFile(new URL(`../src/fixtures/${name}`, import.meta.url), "utf8");
  }
}
const howogeFeedSchema = z.object({
  immocount: z.number().int().nonnegative(),
  teasercount: z.number().int().nonnegative(),
  immoobjects: z.array(z.unknown()),
});
const howogeItemSchema = z.object({
  uid: z.number().int().positive(),
  title: z.string().trim().min(1),
  link: z.string(),
  notice: z.string().nullish(),
  district: z.string().nullish(),
  rent: z.number().nonnegative().nullable(),
  area: z.number().positive().nullable(),
  rooms: z.number().positive().nullable(),
  wbs: z.string().nullish(),
  features: z.array(z.string()).default([]),
  image: z.string().nullish(),
  coordinates: z.object({ lat: z.union([z.string(), z.number()]), lng: z.union([z.string(), z.number()]) }).nullish(),
});

function officialUrl(value: string, portal: MunicipalPortal) {
  const base = new URL(municipalSourceUrls[portal]);
  const url = new URL(value, base);
  if (url.origin !== base.origin || url.username || url.password) {
    throw new Error(`${portal}: expected an official HTTPS URL.`);
  }
  return url;
}

function baseListing(portal: MunicipalPortal, id: string, url: string): ListingUpsertInput {
  return {
    portal,
    portalListingId: id,
    url,
    canonicalUrl: url,
    title: "",
    description: null,
    addressLine: null,
    city: null,
    district: null,
    neighborhood: null,
    latitude: null,
    longitude: null,
    geoSource: null,
    rentCold: null,
    rentWarm: null,
    sizeSqm: null,
    rooms: null,
    floor: null,
    availableFrom: null,
    isFurnished: false,
    hasBalcony: false,
    hasElevator: false,
    rawPayload: null,
  };
}

export function parseHowogeFeed(payload: unknown, mode: "fixture" | "live" = "live") {
  const feed = howogeFeedSchema.parse(payload);
  const listings: ListingUpsertInput[] = [];
  let invalid = 0;
  for (const raw of feed.immoobjects) {
    try {
      const item = howogeItemSchema.parse(raw);
      const url = officialUrl(item.link, "HOWOGE");
      if (!/^\/immobiliensuche\/wohnungssuche\/detail\/[^/]+\.html$/.test(url.pathname))
        throw new Error("Invalid detail URL");
      const features = item.features.join(" · ");
      const lat = Number(item.coordinates?.lat);
      const lng = Number(item.coordinates?.lng);
      const coordinates =
        item.coordinates &&
        String(item.coordinates.lat).trim() &&
        String(item.coordinates.lng).trim() &&
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        Math.abs(lat) <= 90 &&
        Math.abs(lng) <= 180;
      const image = item.image ? officialUrl(item.image, "HOWOGE").href : null;
      listings.push(
        listingUpsertInputSchema.parse({
          ...baseListing("HOWOGE", String(item.uid), url.href),
          title: [item.notice, item.title].filter(Boolean).join(" · "),
          addressLine: item.title,
          city: item.title.match(/\b\d{5}\s+(.+)$/)?.[1] ?? null,
          district: item.district ?? null,
          description: [item.notice, item.wbs === "ja" ? "WBS erforderlich" : null, features]
            .filter(Boolean)
            .join(". "),
          rentWarm: item.rent,
          sizeSqm: item.area,
          rooms: item.rooms,
          latitude: coordinates ? lat : null,
          longitude: coordinates ? lng : null,
          geoSource: coordinates ? "portal_coordinates" : null,
          hasBalcony: /Balkon|Loggia|Terrasse/i.test(features),
          hasElevator: /Aufzug|Fahrstuhl/i.test(features),
          rawPayload: { source: mode, item: raw, search: { coverImageUrl: image } },
        }),
      );
    } catch {
      invalid += 1;
    }
  }
  // The current feed returns all individual units in one response. Project teasers
  // count multiple future units and must not be manufactured into listings.
  const missing = Math.max(0, feed.immocount - feed.teasercount - feed.immoobjects.length);
  return { listings, invalid, missing };
}

export function parseGewobagPage(html: string, mode: "fixture" | "live" = "live") {
  const $ = cheerio.load(html);
  const cards = $("article.angebot-big-box");
  if (!$(".filtered-mietangebote").length) throw new Error("GEWOBAG: unexpected results page.");
  const listings: ListingUpsertInput[] = [];
  let invalid = 0;
  cards.each((_, element) => {
    const card = $(element);
    // Only whole apartments, never garages or commercial units.
    if (!card.find("table.wohnung-info").length) return;
    try {
      const url = officialUrl(card.find(".angebot-footer a.read-more-link").attr("href") ?? "", "GEWOBAG");
      const id = url.pathname.match(/\/mietangebote\/([^/]+)\/?$/)?.[1];
      if (!id) throw new Error("Missing listing ID");
      const address = normalizeReadableText(card.find("address").text());
      const area = normalizeReadableText(card.find(".angebot-area td").text());
      const features = normalizeReadableText(card.find(".angebot-characteristics td").text());
      const priceLabel = normalizeReadableText(card.find(".angebot-kosten th").text());
      const price = parseNumber(card.find(".angebot-kosten td").text());
      const images = card
        .find("img")
        .toArray()
        .map((img) => $(img).attr("src"))
        .filter((src): src is string => Boolean(src))
        .map((src) => officialUrl(src, "GEWOBAG").href);
      const locality = address.match(/\b\d{5}\s+([^/]+)(?:\/(.+))?$/);
      listings.push(
        listingUpsertInputSchema.parse({
          ...baseListing("GEWOBAG", id, url.href),
          title: normalizeReadableText(card.find(".angebot-title").text()) || address,
          addressLine: address || null,
          city: locality?.[1]?.trim() ?? null,
          district: locality?.[2]?.trim() ?? (normalizeReadableText(card.find(".angebot-region td").text()) || null),
          neighborhood: normalizeReadableText(card.find(".angebot-region td").text()) || null,
          description: normalizeReadableText(card.find("table").text()),
          rooms: parseNumber(area.match(/([\d,.]+)\s*Zimmer/i)?.[1]),
          sizeSqm: parseNumber(area.match(/([\d,.]+)\s*m[²2]/i)?.[1]),
          rentWarm: /Gesamtmiete|Warmmiete/i.test(priceLabel) ? price : null,
          rentCold: /Kaltmiete|Nettokaltmiete/i.test(priceLabel) ? price : null,
          availableFrom: normalizeReadableText(card.find(".availability td").text()) || null,
          hasBalcony: /Balkon|Loggia|Terrasse|Terasse/i.test(features),
          hasElevator: /Aufzug|Fahrstuhl/i.test(features),
          rawPayload: { source: mode, search: { imageUrls: images } },
        }),
      );
    } catch {
      invalid += 1;
    }
  });
  const next = $("a.next.page-numbers").attr("href") ?? null;
  return { listings, invalid, next };
}

function result(
  listings: ListingUpsertInput[],
  mode: "fixture" | "live",
  invalid = 0,
  error: string | null = null,
): SourceScrapeResult {
  return {
    listings,
    listingsFound: listings.length + invalid,
    failedDetails: invalid + (error ? 1 : 0),
    detailFailures: { blocked: 0, invalid, error: error ? 1 : 0 },
    mode,
    authStatus: "ready",
    authError: error,
    challengeType: null,
    sessionState: null,
    sessionExpiresAt: null,
    authenticatedAt: null,
    validatedAt: new Date(),
  };
}

async function request(context: SourceAdapterContext, url: URL, init?: RequestInit) {
  const signal = AbortSignal.timeout(25_000);
  let target = url;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await (context.fetchImpl ?? fetch)(target, {
      ...init,
      signal,
      redirect: "manual",
      headers: { "Accept-Language": "de-DE,de;q=0.9", ...init?.headers },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      const destination = location ? new URL(location, target) : null;
      if (!destination || destination.origin !== url.origin || destination.username || destination.password) {
        throw new Error(`${url.hostname}: unexpected redirect outside the official site.`);
      }
      if (response.status === 303 || ([301, 302].includes(response.status) && init?.method === "POST"))
        init = undefined;
      target = destination;
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${url.hostname}`);
    return response;
  }
  throw new Error(`${url.hostname}: too many redirects.`);
}

function forCity(listings: ListingUpsertInput[], city: string) {
  return listings.filter((listing) => !listing.city || listing.city.toLowerCase() === city.trim().toLowerCase());
}

export const howogeAdapter: SourceAdapter = {
  portal: "HOWOGE",
  capabilities: municipalSourceCapabilities.HOWOGE,
  defaultSource(settings) {
    return {
      searchUrl: municipalSourceUrls.HOWOGE,
      searchParams: { city: settings.search.city },
      scrapeIntervalMinutes: 5,
    };
  },
  async scrape(context) {
    const mode = context.scrapeWithFixtures ? "fixture" : "live";
    const search = officialUrl(context.searchUrl, "HOWOGE");
    const body = new URLSearchParams();
    for (const [key, value] of search.searchParams) {
      if (/^tx_howrealestate_json_list\[(kiez|rooms|wbs)\]/.test(key)) body.append(key, value);
    }
    const payload = context.scrapeWithFixtures
      ? JSON.parse(await fixture("howoge/search.json"))
      : await (
          await request(context, new URL("/?type=999&tx_howrealestate_json_list[action]=immoList", search), {
            method: "POST",
            body,
          })
        ).json();
    const parsed = parseHowogeFeed(payload, mode);
    return result(
      forCity(parsed.listings, context.settings.search.city),
      mode,
      parsed.invalid,
      parsed.missing ? `HOWOGE: feed incomplete, ${parsed.missing} individual listings missing.` : null,
    );
  },
};

export const gewobagAdapter: SourceAdapter = {
  portal: "GEWOBAG",
  capabilities: municipalSourceCapabilities.GEWOBAG,
  defaultSource(settings) {
    return {
      searchUrl: municipalSourceUrls.GEWOBAG,
      searchParams: { city: settings.search.city },
      scrapeIntervalMinutes: 5,
    };
  },
  async scrape(context) {
    const mode = context.scrapeWithFixtures ? "fixture" : "live";
    let next: string | null = context.searchUrl;
    const visited = new Set<string>();
    const listings = new Map<string, ListingUpsertInput>();
    let invalid = 0;
    try {
      while (next) {
        const url = officialUrl(next, "GEWOBAG");
        if (visited.has(url.href) || visited.size >= MAX_PAGES)
          throw new Error("GEWOBAG: pagination incomplete or repeated.");
        if (visited.size > 0) await new Promise((resolve) => setTimeout(resolve, 750));
        visited.add(url.href);
        const html = context.scrapeWithFixtures
          ? await fixture("gewobag/search.html")
          : await (await request(context, url)).text();
        const parsed = parseGewobagPage(html, mode);
        invalid += parsed.invalid;
        for (const listing of forCity(parsed.listings, context.settings.search.city))
          listings.set(listing.canonicalUrl, listing);
        next = context.scrapeWithFixtures ? null : parsed.next;
      }
    } catch (error) {
      if (!listings.size) throw error;
      return result(
        [...listings.values()],
        mode,
        invalid,
        error instanceof Error ? error.message : "GEWOBAG: incomplete collection.",
      );
    }
    return result([...listings.values()], mode, invalid);
  },
};
