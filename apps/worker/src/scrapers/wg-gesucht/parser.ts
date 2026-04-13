import * as cheerio from "cheerio";

import {
  collectJsonLd,
  collectJsonLdImageUrls,
  collectMarkupImageUrls,
  normalizeReadableText,
  normalizeToken,
  parseNumber,
  resolveUrl,
  uniqueByUrl,
  uniqueStrings,
  type JsonRecord
} from "../shared/utils";

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

  const localityMatch = text.match(/Berlin[-,\s]+([A-Za-zÄÖÜäöüß/ -]+)/i);

  if (localityMatch?.[1]) {
    return localityMatch[1].trim().replace(/\s+/g, " ");
  }

  const addressMatch = text.match(/\b(\d{5})\s+([A-Za-zÄÖÜäöüß/ -]+)$/);
  if (addressMatch?.[2]) {
    return addressMatch[2].trim();
  }

  return null;
}

function extractAddress(record: JsonRecord | null | undefined) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const parts = [
    typeof record.streetAddress === "string" ? record.streetAddress : null,
    typeof record.postalCode === "string" ? record.postalCode : null,
    typeof record.addressLocality === "string" ? record.addressLocality : null,
    typeof record.addressRegion === "string" ? record.addressRegion : null
  ].filter((part): part is string => Boolean(part?.trim()));

  return parts.length > 0 ? parts.join(", ") : null;
}

function parseKeyFacts($root: cheerio.CheerioAPI) {
  const keyFacts = new Map<string, string>();

  $root(".key_fact_detail").toArray().forEach((element) => {
    const label = normalizeToken($root(element).text());
    const container = $root(element).closest("div");
    const value = normalizeReadableText(container.find(".key_fact_value").first().text());

    if (label && value) {
      keyFacts.set(label, value);
    }
  });

  return keyFacts;
}

function parseSectionPanelValues($root: cheerio.CheerioAPI) {
  const values = new Map<string, string>();

  $root(".section_panel_detail, .section_panel_value").toArray().forEach((element) => {
    const node = $root(element);

    if (!node.hasClass("section_panel_detail")) {
      return;
    }

    const label = normalizeToken(node.text()).replace(/:$/, "");
    const value = normalizeReadableText(node.closest(".row").find(".section_panel_value").first().text());

    if (label && value) {
      values.set(label, value);
    }
  });

  return values;
}

function getFactValue(values: Map<string, string>, labels: string[]) {
  for (const label of labels) {
    const direct = values.get(label);

    if (direct) {
      return direct;
    }
  }

  for (const [key, value] of values.entries()) {
    if (labels.some((label) => key.includes(label))) {
      return value;
    }
  }

  return null;
}

function parseSearchCard($root: cheerio.CheerioAPI, element: any, baseUrl: string): SearchResult | null {
  const card = $root(element);
  const link = card.find("h2 a").first();
  const rawHref = link.attr("href");

  if (!rawHref) {
    return null;
  }

  const url = resolveUrl(rawHref, baseUrl);
  const title = normalizeReadableText(link.text());
  const bodyText = normalizeReadableText(card.find(".card_body").text());
  const addressLine =
    normalizeReadableText(card.find(".col-sm-3 b").last().text()) ||
    normalizeReadableText(card.find(".col-sm-3").last().text()) ||
    null;
  const imageUrls = collectMarkupImageUrls($root, baseUrl, card);

  return {
    portalListingId: card.attr("data-id") ?? url.match(/\.([0-9]+)\.html$/)?.[1] ?? null,
    title,
    url,
    coverImageUrl: imageUrls[0] ?? null,
    imageUrls,
    addressLine,
    district: extractDistrict(addressLine ?? bodyText),
    latitude: null,
    longitude: null,
    rentCold: null,
    rentWarm: parseNumber(bodyText.match(/([\d.,]+)\s*€/i)?.[1]),
    sizeSqm: parseNumber(bodyText.match(/([\d.,]+)\s*m²/i)?.[1]),
    rooms: parseNumber(bodyText.match(/([\d.,]+)\s*(?:Zimmer|Room)/i)?.[1])
  };
}

function parseSearchJsonLd(records: JsonRecord[], baseUrl: string): SearchResult[] {
  return records
    .filter((record) => record["@type"] === "RealEstateListing" && typeof record.url === "string")
    .map((record) => {
      const addressRecord =
        record.mainEntity && typeof record.mainEntity === "object" && !Array.isArray(record.mainEntity)
          ? ((record.mainEntity as JsonRecord).address as JsonRecord | undefined)
          : undefined;
      const addressLine = extractAddress(addressRecord);
      const imageUrls = collectJsonLdImageUrls([record], baseUrl);

      return {
        portalListingId: String(record.url).match(/\.([0-9]+)\.html$/)?.[1] ?? null,
        title: normalizeReadableText(typeof record.name === "string" ? record.name : null),
        url: resolveUrl(String(record.url), baseUrl),
        coverImageUrl: imageUrls[0] ?? null,
        imageUrls,
        addressLine,
        district:
          (typeof addressRecord?.addressRegion === "string" ? addressRecord.addressRegion : null) ??
          extractDistrict(addressLine),
        latitude: null,
        longitude: null,
        rentCold: null,
        rentWarm: parseNumber(
          typeof (record.offers as JsonRecord | undefined)?.price === "string"
            ? String((record.offers as JsonRecord).price)
            : null
        ),
        sizeSqm: parseNumber(
          typeof (record as JsonRecord).floorSize === "string" ? String((record as JsonRecord).floorSize) : null
        ),
        rooms: parseNumber(typeof (record as JsonRecord).numberOfRooms === "string" ? String(record.numberOfRooms) : null)
      } satisfies SearchResult;
    });
}

export function parseWgGesuchtSearchResults(html: string, baseUrl: string) {
  const $ = cheerio.load(html);
  const cards: SearchResult[] = $(".offer_list_item")
    .toArray()
    .map((element) => parseSearchCard($, element, baseUrl))
    .filter((item): item is SearchResult => Boolean(item));
  const jsonLdItems = parseSearchJsonLd(collectJsonLd($), baseUrl);
  const byUrl = new Map<string, SearchResult>();

  for (const item of [...jsonLdItems, ...cards]) {
    const existing = byUrl.get(item.url);
    byUrl.set(item.url, {
      ...existing,
      ...item,
      title: item.title || existing?.title || "",
      coverImageUrl: item.coverImageUrl ?? existing?.coverImageUrl ?? null,
      imageUrls: uniqueStrings([...(existing?.imageUrls ?? []), ...item.imageUrls]),
      addressLine: item.addressLine ?? existing?.addressLine ?? null,
      district: item.district ?? existing?.district ?? null,
      rentWarm: item.rentWarm ?? existing?.rentWarm ?? null,
      sizeSqm: item.sizeSqm ?? existing?.sizeSqm ?? null,
      rooms: item.rooms ?? existing?.rooms ?? null
    });
  }

  return uniqueByUrl([...byUrl.values()]).filter((item) => Boolean(item.title && item.url));
}

export function parseWgGesuchtDetail(html: string, url: string): DetailResult {
  const $ = cheerio.load(html);
  const structuredImageUrls = collectJsonLdImageUrls(collectJsonLd($), url);
  const imageUrls = uniqueStrings([...structuredImageUrls, ...collectMarkupImageUrls($, url)]);
  const pageText = normalizeReadableText($.root().text());
  const keyFacts = parseKeyFacts($);
  const sectionPanels = parseSectionPanelValues($);
  const title =
    normalizeReadableText($('meta[property="og:title"]').attr("content")) ||
    normalizeReadableText($("title").text()).split(" - ")[0] ||
    null;
  const description =
    normalizeReadableText($('meta[name="Description"]').attr("content")) ||
    normalizeReadableText($('meta[property="og:description"]').attr("content")) ||
    null;
  const canonicalUrl = normalizeReadableText($('link[rel="canonical"]').attr("href")) || url;
  const district = extractDistrict(canonicalUrl) ?? extractDistrict(title) ?? extractDistrict(description) ?? null;
  const addressLineMatch = description?.match(/([A-Za-zÄÖÜäöüß0-9./ -]+,\s*\d{5}\s*Berlin)/i);
  const addressLine = addressLineMatch?.[1]?.trim() ?? null;
  const rentWarm =
    parseNumber(getFactValue(keyFacts, ["gesamtmiete"])) ??
    parseNumber(getFactValue(sectionPanels, ["miete", "gesamtmiete", "warmmiete"])) ??
    parseNumber(description?.match(/([\d.,]+)\s*€/i)?.[1]) ??
    null;
  const sizeSqm =
    parseNumber(getFactValue(keyFacts, ["gro", "size"])) ??
    parseNumber(description?.match(/([\d.,]+)\s*m²/i)?.[1]) ??
    parseNumber(pageText.match(/([\d.,]+)\s*m²/i)?.[1] ?? null);
  const rooms =
    parseNumber(getFactValue(keyFacts, ["zimmer", "room"])) ??
    parseNumber(description?.match(/([\d.,]+)\s*(?:Zimmer|Room)/i)?.[1]) ??
    parseNumber(pageText.match(/([\d.,]+)\s*(?:Zimmer|Room)/i)?.[1] ?? null);

  return {
    title,
    description,
    coverImageUrl: imageUrls[0] ?? null,
    imageUrls,
    addressLine,
    city: "Berlin",
    district,
    neighborhood: district,
    latitude: null,
    longitude: null,
    rentCold: null,
    rentWarm,
    sizeSqm,
    rooms,
    floor: null,
    availableFrom: getFactValue(sectionPanels, ["frei ab", "available from"]) ?? null,
    isFurnished: /möbliert|furnished/i.test(pageText),
    hasBalcony: /balkon|terrasse/i.test(pageText),
    hasElevator: /aufzug|elevator/i.test(pageText)
  };
}

export function looksBlockedWgGesuchtPage(html: string) {
  const $ = cheerio.load(html);
  const text = normalizeReadableText($("body").text()).toLowerCase();

  return [
    "access denied",
    "forbidden",
    "security check",
    "i am not a robot",
    "ich bin kein roboter",
    "captcha",
    "challenge"
  ].some((needle) => text.includes(needle));
}

export function looksNonListingWgGesuchtPage(url: string, html: string) {
  return !/\/wohnungen?-in-.*\.[0-9]+\.html$/i.test(url) || looksBlockedWgGesuchtPage(html);
}
