import * as cheerio from "cheerio";

import { canonicalizeListingUrl } from "@flathunter/shared";

export type JsonRecord = Record<string, unknown>;

export function parseNumber(input: string | undefined | null) {
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

export function normalizeReadableText(value: string | null | undefined) {
  return value
    ?.replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim() ?? "";
}

export function normalizeToken(value: string | null | undefined) {
  return normalizeReadableText(value)
    .normalize("NFKD")
    .replace(/[^\w\s./:-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function collectJsonLd($root: cheerio.CheerioAPI) {
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
        // Ignore malformed JSON-LD blocks.
      }
    });

  return records;
}

export function flattenJsonLd(value: unknown): JsonRecord[] {
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
    ...flattenJsonLd(record.mainEntity),
    ...flattenJsonLd(record.itemListElement),
    ...flattenJsonLd(record.item),
    ...flattenJsonLd(record.offers),
    ...flattenJsonLd(record.address),
    ...flattenJsonLd(record.geo)
  ];
}

export function resolveUrl(rawUrl: string, baseUrl: string) {
  return canonicalizeListingUrl(new URL(rawUrl, baseUrl).toString());
}

export function extractListingIdFromPath(url: string, pattern: RegExp) {
  return url.match(pattern)?.[1] ?? null;
}

export function uniqueByUrl<T extends { url: string }>(items: T[]) {
  const seen = new Set<string>();

  return items.filter((item) => {
    if (seen.has(item.url)) {
      return false;
    }

    seen.add(item.url);
    return true;
  });
}

export function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

export function resolveAssetUrl(rawValue: string | null | undefined, baseUrl: string) {
  const value = normalizeReadableText(rawValue);

  if (!value || value.startsWith("data:")) {
    return null;
  }

  try {
    const resolved = new URL(value, baseUrl);

    if (!["http:", "https:"].includes(resolved.protocol)) {
      return null;
    }

    const pathname = resolved.pathname.toLowerCase();

    if (pathname.endsWith(".svg") || pathname.endsWith(".ico")) {
      return null;
    }

    return resolved.toString();
  } catch {
    return null;
  }
}

export function resolveSrcSetUrls(rawValue: string | null | undefined, baseUrl: string) {
  if (!rawValue) {
    return [];
  }

  return rawValue
    .split(",")
    .map((entry) => resolveAssetUrl(entry.trim().split(/\s+/)[0] ?? null, baseUrl))
    .filter((value): value is string => Boolean(value));
}

export function collectMarkupImageUrls(
  $root: cheerio.CheerioAPI,
  baseUrl: string,
  scope?: cheerio.Cheerio<any>
) {
  const seen = new Set<string>();
  const root = scope ?? $root.root();

  if (!scope) {
    $root('meta[property="og:image"], meta[name="twitter:image"], meta[property="twitter:image"]')
      .toArray()
      .forEach((element) => {
        const node = $root(element);
        const resolved = resolveAssetUrl(node.attr("content"), baseUrl);

        if (resolved) {
          seen.add(resolved);
        }
      });
  }

  root.find("img, source").toArray().forEach((element) => {
    const node = $root(element);

    [
      node.attr("src"),
      node.attr("data-src"),
      node.attr("data-lazy-src"),
      node.attr("data-original"),
      node.attr("data-image"),
      node.attr("content")
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

  return [...seen];
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

export function collectJsonLdImageUrls(records: JsonRecord[], baseUrl: string) {
  const seen = new Set<string>();

  records.forEach((record) => {
    collectStructuredImageUrls(record, baseUrl, seen);
  });

  return [...seen];
}
