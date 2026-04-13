import * as cheerio from "cheerio";

import { collectMarkupImageUrls, normalizeReadableText, parseNumber, resolveUrl, uniqueByUrl } from "../shared/utils";

type SearchResult = {
  portalListingId: string | null;
  title: string;
  url: string;
  coverImageUrl: string | null;
  imageUrls: string[];
  addressLine: string | null;
  district: string | null;
  latitude: number | null;
  longitude: number | null;
  rentCold: number | null;
  rentWarm: number | null;
  sizeSqm: number | null;
  rooms: number | null;
};

type DetailResult = {
  title: string | null;
  description: string | null;
  coverImageUrl: string | null;
  imageUrls: string[];
  addressLine: string | null;
  city: string | null;
  district: string | null;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
  rentCold: number | null;
  rentWarm: number | null;
  sizeSqm: number | null;
  rooms: number | null;
  floor: string | null;
  availableFrom: string | null;
  isFurnished: boolean;
  hasBalcony: boolean;
  hasElevator: boolean;
};

function extractDistrict(value: string | null | undefined) {
  const text = normalizeReadableText(value);
  const match = text.match(/Berlin[-,\s]+([A-Za-zÄÖÜäöüß/ -]+)/i);
  return match?.[1]?.trim() ?? null;
}

export function parseImmoscout24SearchResults(html: string, baseUrl: string) {
  const $ = cheerio.load(html);
  const results = $(
    '[data-testid="result-list-entry"] a[href*="/expose/"], [data-testid="serp-core-classified-card-testid"] a[href*="/expose/"]'
  )
    .toArray()
    .map((element) => {
      const link = $(element);
      const href = link.attr("href");

      if (!href) {
        return null;
      }

      const url = resolveUrl(href, baseUrl);
      const card = link.closest('[data-testid="result-list-entry"], [data-testid="serp-core-classified-card-testid"]');
      const text = normalizeReadableText(card.text());
      const imageUrls = collectMarkupImageUrls($, baseUrl, card);

      return {
        portalListingId: url.match(/\/expose\/([^/?#]+)/i)?.[1] ?? null,
        title: normalizeReadableText(link.text()) || normalizeReadableText(link.attr("title")),
        url,
        coverImageUrl: imageUrls[0] ?? null,
        imageUrls,
        addressLine: null,
        district: extractDistrict(text),
        latitude: null,
        longitude: null,
        rentCold: null,
        rentWarm: parseNumber(text.match(/([\d.,]+)\s*€/i)?.[1]),
        sizeSqm: parseNumber(text.match(/([\d.,]+)\s*m²/i)?.[1]),
        rooms: parseNumber(text.match(/([\d.,]+)\s*Zimmer/i)?.[1])
      };
    })
    .filter((item) => Boolean(item && item.url));

  return uniqueByUrl(results as SearchResult[]);
}

export function parseImmoscout24Detail(html: string): DetailResult {
  const $ = cheerio.load(html);
  const imageUrls = collectMarkupImageUrls($, "https://www.immobilienscout24.de/");
  const pageText = normalizeReadableText($.root().text());
  const title =
    normalizeReadableText($('meta[property="og:title"]').attr("content")) ||
    normalizeReadableText($("title").text()) ||
    null;

  return {
    title,
    description:
      normalizeReadableText($('meta[name="description"]').attr("content")) ||
      normalizeReadableText($('meta[property="og:description"]').attr("content")) ||
      null,
    coverImageUrl: imageUrls[0] ?? null,
    imageUrls,
    addressLine: null,
    city: pageText.includes("Berlin") ? "Berlin" : null,
    district: extractDistrict(pageText),
    neighborhood: extractDistrict(pageText),
    latitude: parseNumber($('meta[property="og:latitude"]').attr("content")),
    longitude: parseNumber($('meta[property="og:longitude"]').attr("content")),
    rentCold: null,
    rentWarm: parseNumber(pageText.match(/([\d.,]+)\s*€/i)?.[1] ?? null),
    sizeSqm: parseNumber(pageText.match(/([\d.,]+)\s*m²/i)?.[1] ?? null),
    rooms: parseNumber(pageText.match(/([\d.,]+)\s*Zimmer/i)?.[1] ?? null),
    floor: null,
    availableFrom: null,
    isFurnished: /möbliert|furnished/i.test(pageText),
    hasBalcony: /balkon|terrasse/i.test(pageText),
    hasElevator: /aufzug|elevator/i.test(pageText)
  };
}

export function looksBlockedImmoscout24Page(html: string) {
  const text = normalizeReadableText(html).toLowerCase();

  return [
    "ich bin kein roboter",
    "fälschlicherweise als roboter identifiziert",
    "security measure",
    "access denied",
    "captcha"
  ].some((needle) => text.includes(needle));
}

export function looksNonListingImmoscout24Page(url: string, html: string) {
  return !/\/expose\//i.test(url) || looksBlockedImmoscout24Page(html);
}
