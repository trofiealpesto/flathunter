import { z } from "zod";

import type { ListingUpsertInput } from "@flathunter/shared";

import type { SourceAdapter, SourceScrapeResult } from "../types";

const FLATSFORFRIENDZ_APP_ORIGIN = "https://app.flatsforfriendz.com";
const FLATSFORFRIENDZ_API_BASE_URL = "https://api.production.flatsforfriendz.com";
const DEFAULT_LANGUAGE = "en";
const DEFAULT_TAKE = 25;
const MAX_PAGES = 10;

const visualSchema = z.object({
  url: z.string().url(),
  type: z.string().optional()
});

const addressSchema = z.object({
  postalCode: z.string().nullable().optional(),
  cityPart: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  fuzzyLat: z.number().nullable().optional(),
  fuzzyLong: z.number().nullable().optional()
});

const feedListingDataSchema = z.object({
  uuid: z.string().uuid(),
  displayId: z.string().min(1),
  info: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  type: z.string(),
  price: z.number().nullable().optional(),
  deposit: z.number().nullable().optional(),
  rentalPeriod: z.string().nullable().optional(),
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  furnished: z.string().nullable().optional(),
  furnitureObjects: z.array(z.string()).optional().default([]),
  contracts: z.array(z.string()).optional().default([]),
  special: z.array(z.string()).optional().default([]),
  friendliness: z.array(z.string()).optional().default([]),
  rooms: z.number().nullable().optional(),
  size: z.number().nullable().optional(),
  roomSize: z.number().nullable().optional(),
  visibility: z.string().nullable().optional(),
  visuals: z.array(visualSchema).optional().default([]),
  address: addressSchema.nullable().optional()
});

const feedListingSchema = z.object({
  type: z.string(),
  data: feedListingDataSchema
});

const feedResponseSchema = z.object({
  data: z.array(feedListingSchema),
  meta: z.object({
    page: z.number().int().positive(),
    take: z.number().int().positive(),
    isLastPage: z.boolean()
  })
});

function humanizeEnumToken(value: string) {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function buildReadableSearchUrl(city: string) {
  const params = new URLSearchParams({
    locations: city,
    types: "FLAT"
  });

  return `${FLATSFORFRIENDZ_APP_ORIGIN}/en?${params.toString()}`;
}

function buildListingUrl(uuid: string) {
  return `${FLATSFORFRIENDZ_APP_ORIGIN}/listing/offer/${uuid}`;
}

function buildAddressLine(address: z.infer<typeof addressSchema> | null | undefined) {
  if (!address) {
    return null;
  }

  const locality = [address.cityPart, address.city].filter(Boolean).join(", ");

  if (!locality && !address.postalCode) {
    return null;
  }

  return [locality || null, address.postalCode ? `(${address.postalCode})` : null].filter(Boolean).join(" ");
}

function buildDescription(data: z.infer<typeof feedListingDataSchema>) {
  const parts: string[] = [];

  if (data.info) {
    parts.push(data.info.trim());
  }

  const coreFacts = [
    data.rooms != null ? `${data.rooms} rooms` : null,
    data.size != null ? `${data.size} m²` : data.roomSize != null ? `${data.roomSize} m² room size` : null,
    data.price != null ? `${data.price} EUR` : null
  ].filter(Boolean);

  if (coreFacts.length > 0) {
    parts.push(coreFacts.join(" · "));
  }

  if (data.deposit != null) {
    parts.push(`Deposit ${data.deposit} EUR`);
  }

  if (data.rentalPeriod === "LIMITED" && data.startTime) {
    const period = [data.startTime.slice(0, 10), data.endTime?.slice(0, 10) ?? null].filter(Boolean).join(" to ");
    parts.push(`Limited rental period ${period}`);
  }

  if (data.furnished && data.furnished !== "UNFURNISHED") {
    parts.push(humanizeEnumToken(data.furnished));
  }

  if (data.furnitureObjects.length > 0) {
    parts.push(`Furniture: ${data.furnitureObjects.map(humanizeEnumToken).join(", ")}`);
  }

  if (data.contracts.length > 0) {
    parts.push(`Includes: ${data.contracts.map(humanizeEnumToken).join(", ")}`);
  }

  if (data.special.length > 0) {
    parts.push(`Special: ${data.special.map(humanizeEnumToken).join(", ")}`);
  }

  if (data.friendliness.length > 0) {
    parts.push(`Friendliness: ${data.friendliness.map(humanizeEnumToken).join(", ")}`);
  }

  return parts.join(". ") || null;
}

function toImageUrls(data: z.infer<typeof feedListingDataSchema>) {
  return uniqueStrings(data.visuals.map((visual) => visual.url));
}

function inferBooleanFlag(values: string[], pattern: RegExp) {
  return values.some((value) => pattern.test(value));
}

function toListingInput(data: z.infer<typeof feedListingDataSchema>, rawPayload: Record<string, unknown>): ListingUpsertInput {
  const imageUrls = toImageUrls(data);
  const address = data.address ?? null;
  const description = buildDescription(data);
  const signalText = [data.info, description, ...data.special].filter((value): value is string => Boolean(value)).join(" ");

  return {
    portal: "FLATSFORFRIENDZ",
    portalListingId: data.displayId,
    url: buildListingUrl(data.uuid),
    canonicalUrl: buildListingUrl(data.uuid),
    title: data.name?.trim() || data.info?.trim() || `Flat in ${address?.cityPart ?? address?.city ?? "Berlin"}`,
    description,
    addressLine: buildAddressLine(address),
    city: address?.city ?? "Berlin",
    district: address?.cityPart ?? address?.city ?? null,
    neighborhood: address?.cityPart ?? null,
    latitude: address?.fuzzyLat ?? null,
    longitude: address?.fuzzyLong ?? null,
    geoSource: address?.fuzzyLat != null && address?.fuzzyLong != null ? "portal_coordinates" : null,
    rentCold: null,
    rentWarm: data.price ?? null,
    sizeSqm: data.size ?? data.roomSize ?? null,
    rooms: data.rooms ?? null,
    floor: null,
    availableFrom: data.startTime?.slice(0, 10) ?? null,
    isFurnished: Boolean(data.furnished && data.furnished !== "UNFURNISHED"),
    hasBalcony: inferBooleanFlag([signalText], /\bbalcony\b|\bbalkon\b/i),
    hasElevator: inferBooleanFlag([signalText], /\belevator\b|\blift\b|\baufzug\b/i),
    rawPayload: {
      ...rawPayload,
      search: {
        ...data,
        coverImageUrl: imageUrls[0] ?? null,
        imageUrls
      }
    }
  };
}

function looksLikeHtml(value: string) {
  return /^\s*</.test(value);
}

export async function scrapeFlatsforfriendzFeed(
  context: Parameters<SourceAdapter["scrape"]>[0]
): Promise<SourceScrapeResult> {
  const fetchImpl = context.fetchImpl ?? fetch;
  const listings: ListingUpsertInput[] = [];
  let page = 1;
  let listingsFound = 0;

  while (page <= MAX_PAGES) {
    const endpoint = new URL("/search/feed-with-filters/", FLATSFORFRIENDZ_API_BASE_URL);
    endpoint.searchParams.set("includeSuccess", "true");
    endpoint.searchParams.set("language", DEFAULT_LANGUAGE);
    endpoint.searchParams.set("page", String(page));
    endpoint.searchParams.set("take", String(DEFAULT_TAKE));

    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: FLATSFORFRIENDZ_APP_ORIGIN,
        Referer: `${FLATSFORFRIENDZ_APP_ORIGIN}/en`,
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
      },
      body: JSON.stringify({
        input: {
          feedType: "OFFER",
          locations: [context.settings.search.city],
          types: ["FLAT"]
        }
      })
    });

    const responseText = await response.text();

    if (!response.ok) {
      return {
        listings: [],
        listingsFound: 0,
        failedDetails: 0,
        detailFailures: {
          blocked: 0,
          invalid: 0,
          error: 0
        },
        mode: "live",
        authStatus: response.status === 401 || response.status === 403 || response.status === 429 ? "challenge_required" : "auth_failed",
        authError: `Flatsforfriendz feed request failed with status ${response.status}`,
        challengeType: response.status === 401 || response.status === 403 || response.status === 429 ? "anti_bot" : null,
        sessionState: null,
        sessionExpiresAt: null,
        authenticatedAt: null,
        validatedAt: new Date()
      };
    }

    if (looksLikeHtml(responseText)) {
      return {
        listings: [],
        listingsFound: 0,
        failedDetails: 0,
        detailFailures: {
          blocked: 0,
          invalid: 0,
          error: 0
        },
        mode: "live",
        authStatus: "challenge_required",
        authError: "Flatsforfriendz returned a non-JSON challenge or bot-protection page.",
        challengeType: "anti_bot",
        sessionState: null,
        sessionExpiresAt: null,
        authenticatedAt: null,
        validatedAt: new Date()
      };
    }

    const payload = feedResponseSchema.parse(JSON.parse(responseText));
    const publicBerlinOffers = payload.data.filter((entry) => {
      const city = entry.data.address?.city?.toLowerCase() ?? "";
      return (
        entry.type === "offerListing" &&
        entry.data.type === "FLAT" &&
        entry.data.visibility === "PUBLIC" &&
        city === context.settings.search.city.toLowerCase()
      );
    });

    listingsFound += publicBerlinOffers.length;
    listings.push(
      ...publicBerlinOffers.map((entry) =>
        toListingInput(entry.data, {
          source: "live",
          page,
          feedType: entry.type,
          payload: entry
        })
      )
    );

    if (payload.meta.isLastPage) {
      break;
    }

    page += 1;
  }

  return {
    listings,
    listingsFound,
    failedDetails: 0,
    detailFailures: {
      blocked: 0,
      invalid: 0,
      error: 0
    },
    mode: "live",
    authStatus: "ready",
    authError: null,
    challengeType: null,
    sessionState: null,
    sessionExpiresAt: null,
    authenticatedAt: null,
    validatedAt: new Date()
  };
}

export const flatsforfriendzAdapter: SourceAdapter = {
  portal: "FLATSFORFRIENDZ",
  capabilities: {
    supportsLogin: false,
    supportsCaptchaSolver: false,
    supportsDetailFallback: false,
    sourceKind: "public_api",
    readiness: "experimental",
    cloudCompatible: true,
    requiresAuthSetup: false,
    setupHint: "Experimental public offers feed. The current integration uses signed-out public offer data and does not require account setup."
  },
  defaultSource(settings) {
    return {
      searchUrl: buildReadableSearchUrl(settings.search.city),
      searchParams: {
        city: settings.search.city,
        feedType: "OFFER",
        types: ["FLAT"],
        language: DEFAULT_LANGUAGE
      }
    };
  },
  async scrape(context) {
    return scrapeFlatsforfriendzFeed(context);
  }
};
