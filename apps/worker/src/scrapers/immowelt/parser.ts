import * as cheerio from "cheerio";

import { canonicalizeListingUrl } from "@flathunter/shared";

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

type JsonRecord = Record<string, unknown>;

function parseNumber(input: string | undefined) {
  if (!input) {
    return null;
  }

  const match = input.match(/-?[\d.,]+/);
  if (!match) {
    return null;
  }

  const stripped = match[0];
  const normalized = stripped.includes(",")
    ? stripped.replace(/\./g, "").replace(",", ".")
    : /^\d+\.\d{1,2}$/.test(stripped)
      ? stripped
      : stripped.replace(/\./g, "");
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

function normalizeText(value: string | null | undefined) {
  return value
    ?.normalize("NFKD")
    .replace(/[^\w\s./:-]/g, " ")
    .replace(/\s+/g, " ")
    .trim() ?? "";
}

function normalizeReadableText(value: string | null | undefined) {
  return value
    ?.replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim() ?? "";
}

function isImmoweltExposeUrl(input: string) {
  try {
    const url = new URL(input);
    const hostname = url.hostname.replace(/^www\./, "");

    return hostname === "immowelt.de" && /^\/expose\/[^/?#]+$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function resolveAssetUrl(rawValue: string | null | undefined, baseUrl: string) {
  const value = rawValue?.trim();

  if (!value || value.startsWith("data:")) {
    return null;
  }

  try {
    const resolved = new URL(value, baseUrl).toString();
    return isImmoweltExposeUrl(resolved) ? null : resolved;
  } catch {
    return null;
  }
}

function resolveSrcSetUrls(rawValue: string | null | undefined, baseUrl: string) {
  if (!rawValue) {
    return [];
  }

  return rawValue
    .split(",")
    .map((entry) => resolveAssetUrl(entry.trim().split(/\s+/)[0] ?? null, baseUrl))
    .filter((value): value is string => Boolean(value));
}

function collectStructuredImageUrls(value: unknown, baseUrl: string, seen: Set<string>, depth = 0): void {
  if (depth > 4 || value == null) {
    return;
  }

  if (typeof value === "string") {
    const resolved = resolveAssetUrl(value, baseUrl);

    if (resolved) {
      seen.add(resolved);
    }

    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectStructuredImageUrls(entry, baseUrl, seen, depth + 1));
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const record = value as JsonRecord;

  ["url", "contentUrl", "thumbnailUrl", "src", "image", "images", "photo", "photos", "associatedMedia", "primaryImageOfPage"].forEach((key) => {
    collectStructuredImageUrls(record[key], baseUrl, seen, depth + 1);
  });
}

function collectMarkupImageUrls($root: cheerio.CheerioAPI, baseUrl: string, scope?: cheerio.Cheerio<any>) {
  const seen = new Set<string>();
  const root = scope ?? $root.root();

  root.find("img").toArray().forEach((element: any) => {
    const node = $root(element);

    [
      node.attr("src"),
      node.attr("data-src"),
      node.attr("data-lazy-src"),
      node.attr("data-original"),
      node.attr("data-image")
    ].forEach((value) => {
      const resolved = resolveAssetUrl(value, baseUrl);

      if (resolved) {
        seen.add(resolved);
      }
    });

    [node.attr("srcset"), node.attr("data-srcset")].forEach((value) => {
      resolveSrcSetUrls(value, baseUrl).forEach((url) => seen.add(url));
    });
  });

  root
    .find('source, meta[property="og:image"], meta[name="twitter:image"], meta[property="twitter:image"]')
    .toArray()
    .forEach((element: any) => {
      const node = $root(element);

      [
        node.attr("src"),
        node.attr("content")
      ].forEach((value) => {
        const resolved = resolveAssetUrl(value, baseUrl);

        if (resolved) {
          seen.add(resolved);
        }
      });

      [node.attr("srcset")].forEach((value) => {
        resolveSrcSetUrls(value, baseUrl).forEach((url) => seen.add(url));
      });
    });

  return [...seen];
}

function extractStructuredRecordImageUrls(record: JsonRecord | null | undefined, baseUrl: string) {
  const seen = new Set<string>();
  collectStructuredImageUrls(record, baseUrl, seen);
  return [...seen];
}

function collectJsonLd($root: cheerio.CheerioAPI) {
  const records: JsonRecord[] = [];

  $root('script[type="application/ld+json"]')
    .toArray()
    .forEach((element) => {
      const raw = $root(element).contents().text().trim();

      if (!raw) {
        return;
      }

      try {
        const parsed = JSON.parse(raw) as unknown;
        flattenJsonLd(parsed).forEach((record) => {
          if (record && typeof record === "object" && !Array.isArray(record)) {
            records.push(record as JsonRecord);
          }
        });
      } catch {
        // Ignore malformed JSON-LD blocks and continue with selector fallbacks.
      }
    });

  return records;
}

function flattenJsonLd(value: unknown): JsonRecord[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenJsonLd(item));
  }

  const record = value as JsonRecord;
  return [
    record,
    ...flattenJsonLd(record["@graph"]),
    ...flattenJsonLd(record.itemListElement),
    ...flattenJsonLd(record.item),
    ...flattenJsonLd(record.mainEntity),
    ...flattenJsonLd(record.itemOffered),
    ...flattenJsonLd(record.offers)
  ];
}

function parseBooleanLabel($root: cheerio.CheerioAPI, labels: string[], pageText: string) {
  const selectorMatch = labels.some(
    (label) => $root(`[data-attr="${label}"]`).text().trim().toLowerCase() === "yes"
  );

  if (selectorMatch) {
    return true;
  }

  return labels.some((label) => normalizeText(pageText).includes(normalizeText(label)));
}

function extractListingIdFromUrl(url: string) {
  const match = url.match(/\/expose\/([^/?#]+)/i);
  return match?.[1] ?? null;
}

function dedupeSearchResults(results: SearchResult[]) {
  const seen = new Set<string>();

  return results.filter((result) => {
    const key = result.url;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function buildAddressLine(address: JsonRecord | null) {
  if (!address) {
    return null;
  }

  const parts = [
    typeof address.streetAddress === "string" ? address.streetAddress : null,
    typeof address.postalCode === "string" ? address.postalCode : null,
    typeof address.addressLocality === "string" ? address.addressLocality : null,
    typeof address.addressRegion === "string" ? address.addressRegion : null
  ].filter((part): part is string => Boolean(part?.trim()));

  return parts.length > 0 ? parts.join(", ") : null;
}

function extractGeoCoordinates(record: JsonRecord | null) {
  if (!record) {
    return {
      latitude: null,
      longitude: null
    };
  }

  const geo = record.geo && typeof record.geo === "object" ? (record.geo as JsonRecord) : record;

  return {
    latitude: parseNumber(
      typeof geo.latitude === "string" || typeof geo.latitude === "number" ? String(geo.latitude) : undefined
    ),
    longitude: parseNumber(
      typeof geo.longitude === "string" || typeof geo.longitude === "number" ? String(geo.longitude) : undefined
    )
  };
}

function parseCardTitleMetadata(value: string | null | undefined) {
  const normalized = normalizeReadableText(value);

  if (!normalized) {
    return {
      title: null,
      price: null,
      rooms: null,
      sizeSqm: null
    };
  }

  const [title] = normalized.split(/\s+-\s+/);

  return {
    title: title?.trim() || null,
    price: parseNumber(normalized.match(/([\d.,]+)\s*€/i)?.[1]),
    rooms: parseNumber(normalized.match(/([\d.,]+)\s*Zimmer/i)?.[1]),
    sizeSqm: parseNumber(normalized.match(/([\d.,]+)\s*m²/i)?.[1])
  };
}

function collectNodeTextCandidates($root: cheerio.CheerioAPI, element: any) {
  const values = new Set<string>();

  $root(element)
    .find("*")
    .contents()
    .toArray()
    .forEach((node) => {
      if (node.type !== "text") {
        return;
      }

      const text = normalizeReadableText(node.data);

      if (text) {
        values.add(text);
      }
    });

  return [...values];
}

function extractListingTitleFromTexts(texts: string[], fallbackTitle: string | null) {
  const directMatch = texts.find(
    (text) =>
      /(wohnung|apartment|studio|penthouse|loft|maisonette|duplex|flat|zimmer)/i.test(text) &&
      !/^\d/.test(text) &&
      !/[€]|\bm²\b|\bgeschoss\b|\bberlin\b|\(\d{5}\)/i.test(text)
  );

  return directMatch ?? fallbackTitle ?? "";
}

function extractDistrictFromTexts(texts: string[]) {
  const addressLine = texts.find((text) => /\bBerlin\b/i.test(text) && /(\(\d{5}\)|,\s*Berlin\b)/i.test(text));

  if (!addressLine) {
    return null;
  }

  const segments = addressLine.split(",").map((segment) => normalizeReadableText(segment));

  if (segments.length < 2) {
    return null;
  }

  const district = segments.at(-2);
  return district && !/\bberlin\b/i.test(district) ? district : null;
}

function extractAddressLineFromTexts(texts: string[]) {
  return (
    texts.find((text) => /\bBerlin\b/i.test(text) && /(\(\d{5}\)|,\s*Berlin\b|\d{5})/i.test(text)) ?? null
  );
}

function extractPriceFieldsFromTexts(texts: string[], fallbackPrice: number | null) {
  const priceToken = texts.find((text) => /[\d.,]+\s*€/i.test(text));
  const priceValue = parseNumber(priceToken ?? undefined) ?? fallbackPrice;

  if (priceValue == null) {
    return {
      rentCold: null,
      rentWarm: null
    };
  }

  if (texts.some((text) => /warmmiete/i.test(text))) {
    return {
      rentCold: null,
      rentWarm: priceValue
    };
  }

  if (texts.some((text) => /kaltmiete/i.test(text))) {
    return {
      rentCold: priceValue,
      rentWarm: null
    };
  }

  return {
    rentCold: null,
    rentWarm: fallbackPrice
  };
}

function getSearchStructuredResults(jsonLd: JsonRecord[], baseUrl: string): SearchResult[] {
  return jsonLd
    .flatMap((entry) => {
      const itemList = Array.isArray(entry.itemListElement) ? entry.itemListElement : [];
      if (itemList.length === 0) {
        return [];
      }

      return itemList.map((item) => {
        const record =
          item && typeof item === "object" && "item" in item && item.item && typeof item.item === "object"
            ? (item.item as JsonRecord)
            : (item as JsonRecord);

        const rawUrl = typeof record.url === "string" ? record.url : "";
        if (!rawUrl) {
          return null;
        }

        const url = canonicalizeListingUrl(new URL(rawUrl, baseUrl).toString());
        if (!isImmoweltExposeUrl(url)) {
          return null;
        }

        const address =
          record.address && typeof record.address === "object" ? (record.address as JsonRecord) : null;
        const offers =
          record.offers && typeof record.offers === "object" ? (record.offers as JsonRecord) : null;
        const floorSize =
          record.floorSize && typeof record.floorSize === "object" ? (record.floorSize as JsonRecord) : null;
        const coordinates = extractGeoCoordinates(record);
        const imageUrls = extractStructuredRecordImageUrls(record, baseUrl);

        const candidate: SearchResult = {
          portalListingId: extractListingIdFromUrl(url),
          title: typeof record.name === "string" ? record.name.trim() : "",
          url,
          coverImageUrl: imageUrls[0] ?? null,
          imageUrls,
          addressLine: buildAddressLine(address),
          district:
            typeof address?.addressRegion === "string"
              ? address.addressRegion
              : typeof address?.addressLocality === "string"
                ? address.addressLocality
                : null,
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          rentCold: null,
          rentWarm: parseNumber(
            typeof offers?.price === "string" || typeof offers?.price === "number" ? String(offers.price) : undefined
          ),
          sizeSqm: parseNumber(
            typeof floorSize?.value === "string" || typeof floorSize?.value === "number"
              ? String(floorSize.value)
              : typeof record.floorSize === "string" || typeof record.floorSize === "number"
                ? String(record.floorSize)
                : undefined
          ),
          rooms: parseNumber(
            typeof record.numberOfRooms === "string" || typeof record.numberOfRooms === "number"
              ? String(record.numberOfRooms)
              : undefined
          )
        };

        return candidate;
      });
    })
    .filter((item): item is SearchResult => item != null && Boolean(item.title) && Boolean(item.url));
}

function getPageLines($root: cheerio.CheerioAPI) {
  const html = $root.root().html() ?? "";

  return html
    .replace(/<\/(div|p|li|dt|dd|section|article|h1|h2|h3|h4|h5|h6|span)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split(/\n+/)
    .map(normalizeText)
    .filter(Boolean);
}

function parseValueFromLines(lines: string[], labels: string[]) {
  const normalizedLabels = labels.map((label) => normalizeText(label));

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    for (const label of normalizedLabels) {
      if (line === label) {
        return lines[index + 1] ?? null;
      }

      if (line.startsWith(`${label} `) || line.startsWith(`${label}:`)) {
        return line.replace(new RegExp(`^${label}:?\\s*`, "i"), "").trim() || null;
      }
    }
  }

  return null;
}

function parseSectionFromText(pageText: string, label: string, terminators: string[]) {
  const boundary =
    terminators.length > 0 ? `(?:${terminators.map(normalizeText).join("|")}|$)` : "$";
  const pattern = new RegExp(`${normalizeText(label)}\\s+(.+?)${boundary}`, "i");
  const match = pageText.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function parseNumberAfterLabel(pageText: string, labels: string[]) {
  for (const label of labels) {
    const pattern = new RegExp(`${normalizeText(label)}\\s+([\\d.,]+)`, "i");
    const match = pageText.match(pattern);

    if (match?.[1]) {
      return parseNumber(match[1]);
    }
  }

  return null;
}

function extractDetailStructuredData(jsonLd: JsonRecord[]) {
  const merged = jsonLd.find(
    (entry) =>
      typeof entry.description === "string" ||
      typeof entry.name === "string" ||
      entry.address ||
      entry.offers ||
      entry.floorSize
  );

  if (!merged) {
    return {};
  }

  const address = merged.address && typeof merged.address === "object" ? (merged.address as JsonRecord) : null;
  const offers = merged.offers && typeof merged.offers === "object" ? (merged.offers as JsonRecord) : null;
  const floorSize = merged.floorSize && typeof merged.floorSize === "object" ? (merged.floorSize as JsonRecord) : null;
  const coordinates = extractGeoCoordinates(merged);
  const imageUrls = extractStructuredRecordImageUrls(merged, "https://www.immowelt.de");

  return {
    coverImageUrl: imageUrls[0] ?? null,
    imageUrls,
    description:
      typeof merged.description === "string"
        ? merged.description.trim()
        : typeof merged.name === "string"
          ? merged.name.trim()
          : null,
    addressLine: buildAddressLine(address),
    city: typeof address?.addressLocality === "string" ? address.addressLocality : null,
    district:
      typeof address?.addressRegion === "string"
        ? address.addressRegion
        : typeof address?.addressLocality === "string"
          ? address.addressLocality
          : null,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    rentWarm: parseNumber(
      typeof offers?.price === "string" || typeof offers?.price === "number" ? String(offers.price) : undefined
    ),
    sizeSqm: parseNumber(
      typeof floorSize?.value === "string" || typeof floorSize?.value === "number"
        ? String(floorSize.value)
        : typeof merged.floorSize === "string" || typeof merged.floorSize === "number"
          ? String(merged.floorSize)
          : undefined
    ),
    rooms: parseNumber(
      typeof merged.numberOfRooms === "string" || typeof merged.numberOfRooms === "number"
        ? String(merged.numberOfRooms)
        : undefined
    )
  };
}

export function parseImmoweltSearchResults(html: string, baseUrl: string): SearchResult[] {
  const $ = cheerio.load(html);
  const jsonLd = getSearchStructuredResults(collectJsonLd($), baseUrl);
  const structuredByUrl = new Map(jsonLd.map((item) => [item.url, item]));

  const selectorResults: SearchResult[] = $('[data-test="listing-card"], [data-testid="serp-core-classified-card-testid"], [id^="classified-card-"]')
    .toArray()
    .map((element): SearchResult | null => {
      const node = $(element);
      const href =
        node.find('[data-test="listing-url"]').attr("href") ?? node.find('a[href*="/expose/"]').first().attr("href") ?? "";

      if (!href) {
        return null;
      }

      const url = canonicalizeListingUrl(new URL(href, baseUrl).toString());
      if (!isImmoweltExposeUrl(url)) {
        return null;
      }

      const structured = structuredByUrl.get(url);
      const coverLink = node.find('a[href*="/expose/"]').first();
      const titleMetadata = parseCardTitleMetadata(coverLink.attr("title"));
      const textCandidates = collectNodeTextCandidates($, element);
      const textMetrics = extractPriceFieldsFromTexts(textCandidates, structured?.rentWarm ?? titleMetadata.price);
      const imageUrls = uniqueStrings([
        ...collectMarkupImageUrls($, baseUrl, node),
        ...(structured?.imageUrls ?? [])
      ]);

      return {
        portalListingId: node.attr("data-id") ?? structured?.portalListingId ?? extractListingIdFromUrl(url),
        title:
          node.find('[data-test="listing-title"]').text().trim() ||
          extractListingTitleFromTexts(textCandidates, structured?.title ?? titleMetadata.title) ||
          "",
        url: canonicalizeListingUrl(url),
        coverImageUrl: imageUrls[0] ?? structured?.coverImageUrl ?? null,
        imageUrls,
        addressLine: extractAddressLineFromTexts(textCandidates) ?? structured?.addressLine ?? null,
        district: node.find('[data-test="district"]').text().trim() || extractDistrictFromTexts(textCandidates) || structured?.district || null,
        latitude: structured?.latitude ?? null,
        longitude: structured?.longitude ?? null,
        rentCold: textMetrics.rentCold,
        rentWarm: parseNumber(node.find('[data-test="rentWarm"]').text()) ?? textMetrics.rentWarm ?? structured?.rentWarm ?? null,
        sizeSqm:
          parseNumber(node.find('[data-test="sizeSqm"]').text()) ??
          parseNumber(textCandidates.find((text) => /\bm²\b/i.test(text))) ??
          structured?.sizeSqm ??
          titleMetadata.sizeSqm ??
          null,
        rooms:
          parseNumber(node.find('[data-test="rooms"]').text()) ??
          parseNumber(textCandidates.find((text) => /\bzimmer\b/i.test(text))) ??
          structured?.rooms ??
          titleMetadata.rooms ??
          null
      } satisfies SearchResult;
    })
    .filter((item): item is SearchResult => Boolean(item?.title) && Boolean(item?.url));

  return dedupeSearchResults(selectorResults.length > 0 ? selectorResults : jsonLd);
}

export function parseImmoweltDetail(html: string): DetailResult {
  const $ = cheerio.load(html);
  const lines = getPageLines($);
  const pageText = lines.join(" ");
  const structured = extractDetailStructuredData(collectJsonLd($));
  const imageUrls = uniqueStrings([
    ...collectMarkupImageUrls($, "https://www.immowelt.de"),
    ...(structured.imageUrls ?? [])
  ]);
  const rawTitle =
    $('[data-test="listing-title"]').text().trim() ||
    $("h1").first().text().trim() ||
    $('meta[property="og:title"]').attr("content")?.trim() ||
    $("title").text().trim() ||
    null;
  const title = rawTitle && !/^immowelt\.de$/i.test(rawTitle) ? rawTitle : null;
  const description =
    $('[data-test="description"]').text().trim() ||
    parseValueFromLines(lines, ["beschreibung", "description"]) ||
    parseSectionFromText(pageText, "beschreibung", ["warmmiete", "kaltmiete", "wohnflaeche", "zimmer", "frei ab"]) ||
    $('meta[name="description"]').attr("content")?.trim() ||
    structured.description ||
    null;

  return {
    title,
    description,
    coverImageUrl: imageUrls[0] ?? structured.coverImageUrl ?? null,
    imageUrls,
    addressLine:
      $('[data-test="address"]').text().trim() ||
      parseValueFromLines(lines, ["adresse", "anschrift", "address"]) ||
      structured.addressLine ||
      null,
    city:
      $('[data-test="city"]').text().trim() ||
      parseValueFromLines(lines, ["stadt", "city"]) ||
      structured.city ||
      "Berlin",
    district:
      $('[data-test="district"]').text().trim() ||
      parseValueFromLines(lines, ["stadtteil", "bezirk", "district"]) ||
      structured.district ||
      null,
    neighborhood:
      $('[data-test="neighborhood"]').text().trim() ||
      parseValueFromLines(lines, ["kiez", "neighborhood"]) ||
      null,
    latitude: structured.latitude ?? null,
    longitude: structured.longitude ?? null,
    rentCold:
      parseNumber($('[data-test="rentCold"]').text()) ??
      parseNumber(parseValueFromLines(lines, ["kaltmiete"]) ?? undefined) ??
      parseNumberAfterLabel(pageText, ["kaltmiete"]) ??
      null,
    rentWarm:
      parseNumber($('[data-test="rentWarm"]').text()) ??
      parseNumber(parseValueFromLines(lines, ["warmmiete"]) ?? undefined) ??
      parseNumberAfterLabel(pageText, ["warmmiete"]) ??
      structured.rentWarm ??
      null,
    sizeSqm:
      parseNumber($('[data-test="sizeSqm"]').text()) ??
      parseNumber(parseValueFromLines(lines, ["wohnflache", "wohnflaeche", "size"]) ?? undefined) ??
      parseNumberAfterLabel(pageText, ["wohnflache", "wohnflaeche", "size"]) ??
      structured.sizeSqm ??
      null,
    rooms:
      parseNumber($('[data-test="rooms"]').text()) ??
      parseNumber(parseValueFromLines(lines, ["zimmer", "rooms"]) ?? undefined) ??
      parseNumberAfterLabel(pageText, ["zimmer", "rooms"]) ??
      structured.rooms ??
      null,
    floor:
      $('[data-test="floor"]').text().trim() ||
      parseValueFromLines(lines, ["etage", "stockwerk", "floor"]) ||
      null,
    availableFrom:
      $('[data-test="availableFrom"]').text().trim() ||
      parseValueFromLines(lines, ["frei ab", "verfugbar ab", "verfuegbar ab", "available from"]) ||
      parseSectionFromText(pageText, "frei ab", []) ||
      null,
    isFurnished:
      parseBooleanLabel($, ["isFurnished", "mobliert", "moebliert", "furnished"], pageText) ||
      /mobliert|moebliert|furnished/i.test(description ?? ""),
    hasBalcony:
      parseBooleanLabel($, ["hasBalcony", "balkon", "balcony"], pageText) ||
      /balkon|balcony/i.test(description ?? ""),
    hasElevator:
      parseBooleanLabel($, ["hasElevator", "aufzug", "elevator", "lift"], pageText) ||
      /aufzug|elevator|lift/i.test(description ?? "")
  };
}
