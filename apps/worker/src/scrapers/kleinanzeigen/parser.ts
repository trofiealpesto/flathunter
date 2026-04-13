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

  if (!text) {
    return null;
  }

  const localityMatch = text.match(/Berlin\s*[-,]\s*([A-Za-zÄÖÜäöüß/ -]+)/i);
  if (localityMatch?.[1]) {
    return localityMatch[1].trim();
  }

  const postalMatch = text.match(/\b\d{5}\s+([A-Za-zÄÖÜäöüß/ -]+)$/);
  if (postalMatch?.[1]) {
    return postalMatch[1].trim();
  }

  return null;
}

function parseCoordinate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseKleinanzeigenSearchResults(html: string, baseUrl: string) {
  const $ = cheerio.load(html);
  const results = $("article.aditem[data-href]")
    .toArray()
    .map((element) => {
      const card = $(element);
      const href = card.attr("data-href");

      if (!href) {
        return null;
      }

      const url = resolveUrl(href, baseUrl);
      const title = normalizeReadableText(card.find(".aditem-main--middle h2 a").text());
      const locationText = normalizeReadableText(card.find(".aditem-main--top--left").text());
      const description = normalizeReadableText(card.find(".aditem-main--middle--description").text());
      const combinedText = normalizeReadableText(card.text());
      const imageUrls = collectMarkupImageUrls($, baseUrl, card);

      return {
        portalListingId: card.attr("data-adid") ?? url.match(/\/([0-9]+)-[0-9-]+$/)?.[1] ?? null,
        title,
        url,
        coverImageUrl: imageUrls[0] ?? null,
        imageUrls,
        addressLine: locationText || null,
        district: extractDistrict(locationText),
        latitude: null,
        longitude: null,
        rentCold: null,
        rentWarm:
          parseNumber(card.find(".aditem-main--middle--price-shipping--price").text()) ??
          parseNumber(combinedText.match(/([\d.,]+)\s*€/i)?.[1]),
        sizeSqm: parseNumber(`${title} ${description} ${combinedText}`.match(/([\d.,]+)\s*m²/i)?.[1]),
        rooms: parseNumber(`${title} ${description} ${combinedText}`.match(/([\d.,]+)\s*Zimmer/i)?.[1])
      };
    })
    .filter((item) => Boolean(item && item.title && item.url));

  return uniqueByUrl(results as SearchResult[]);
}

function parseDetailsMap($root: cheerio.CheerioAPI) {
  const detailItems = new Map<string, string>();

  $root("#viewad-details .addetailslist--detail")
    .toArray()
    .forEach((element) => {
      const item = $root(element);
      const value = normalizeReadableText(item.find(".addetailslist--detail--value").text());
      const label = normalizeReadableText(item.clone().find(".addetailslist--detail--value").remove().end().text());

      if (label) {
        detailItems.set(label.toLowerCase(), value);
      }
    });

  return detailItems;
}

export function parseKleinanzeigenDetail(html: string): DetailResult {
  const $ = cheerio.load(html);
  const imageUrls = collectMarkupImageUrls($, "https://www.kleinanzeigen.de/");
  const details = parseDetailsMap($);
  const pageText = normalizeReadableText($.root().text());
  const description =
    normalizeReadableText($("#viewad-description-text").text()) ||
    normalizeReadableText($('meta[name="description"]').attr("content")) ||
    null;
  const title =
    normalizeReadableText($('meta[property="og:title"]').attr("content")) ||
    normalizeReadableText($("title").text()).split(" in ")[0] ||
    null;
  const locality = normalizeReadableText($('meta[property="og:locality"]').attr("content")) || null;
  const district = extractDistrict(locality) ?? extractDistrict(description) ?? null;
  const addressLineMatch = description?.match(/(?:Adresse|Address):\s*([^<\n]+)/i);
  const addressLine = addressLineMatch?.[1]?.trim() ?? locality ?? null;
  const rooms = parseNumber(details.get("zimmer")) ?? parseNumber(pageText.match(/([\d.,]+)\s*Zimmer/i)?.[1] ?? null);
  const sizeSqm =
    parseNumber(details.get("wohnfläche")) ?? parseNumber(pageText.match(/([\d.,]+)\s*m²/i)?.[1] ?? null);
  const warmRent = parseNumber(html.match(/"Warmmiete":"?([\d.,]+)"?/i)?.[1] ?? null);
  const coldRent = parseNumber(html.match(/"Preis":"?([\d.,]+)"?/i)?.[1] ?? null);

  return {
    title,
    description,
    coverImageUrl: imageUrls[0] ?? null,
    imageUrls,
    addressLine,
    city: locality?.includes("Berlin") ? "Berlin" : "Berlin",
    district,
    neighborhood: district,
    latitude: parseCoordinate($('meta[property="og:latitude"]').attr("content")),
    longitude: parseCoordinate($('meta[property="og:longitude"]').attr("content")),
    rentCold: coldRent,
    rentWarm: warmRent,
    sizeSqm,
    rooms,
    floor: details.get("etage") ?? null,
    availableFrom: details.get("verfügbar ab") ?? null,
    isFurnished: /möbliert|furnished/i.test(pageText) || /"Moebliert/i.test(html),
    hasBalcony: /balkon|terrasse/i.test(pageText),
    hasElevator: /aufzug/i.test(pageText) || /"Aufzug":"true"/i.test(html)
  };
}

export function looksBlockedKleinanzeigenPage(html: string) {
  const text = normalizeReadableText(html).toLowerCase();
  return ["captcha", "robot", "access denied", "forbidden", "security check"].some((needle) => text.includes(needle));
}

export function looksNonListingKleinanzeigenPage(url: string, html: string) {
  return !/\/s-anzeige\//i.test(url) || looksBlockedKleinanzeigenPage(html);
}
