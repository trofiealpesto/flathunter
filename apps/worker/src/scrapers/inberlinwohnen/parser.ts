import * as cheerio from "cheerio";

import { parseNumber } from "../shared/utils";

export type InberlinwohnenItem = {
  flatId: number;
  objectId: string | null;
  title: string;
  deeplink: string;
  companyName: string | null;
  rooms: number | null;
  sizeSqm: number | null;
  rentCold: number | null;
  extraCosts: number | null;
  rentWarm: number | null;
  availableFrom: string | null;
  postedAt: string | null;
  floor: number | null;
  floorsTotal: number | null;
  constructionYear: string | null;
  wbs: string | null;
  street: string | null;
  houseNumber: string | null;
  zipCode: string | null;
  district: string | null;
  latitude: number | null;
  longitude: number | null;
  hasBalcony: boolean;
  hasElevator: boolean;
  badges: string[];
  imagePath: string | null;
};

/**
 * Livewire serialises nested arrays as [...items, {"s":"arr"}].
 * Strip the marker objects recursively so the payload reads like plain JSON.
 */
function unwrapLivewire(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items =
      value.length > 0 &&
      typeof value[value.length - 1] === "object" &&
      value[value.length - 1] !== null &&
      (value[value.length - 1] as Record<string, unknown>).s === "arr"
        ? value.slice(0, -1)
        : value;
    return items.map(unwrapLivewire);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, unwrapLivewire(entry)]));
  }

  return value;
}

function firstElement(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    const first = value[0];
    return first && typeof first === "object" ? (first as Record<string, unknown>) : null;
  }

  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    return parseNumber(value);
  }

  return null;
}

/** Coordinates arrive as plain decimal strings ("52.49087146") — not German number format. */
function asCoordinate(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

/** "01.07.2026" → "2026-07-01" */
function parseGermanDate(value: unknown): string | null {
  const text = asString(value);
  const match = text?.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);

  if (!match) {
    return null;
  }

  return `${match[3]}-${match[2]}-${match[1]}`;
}

function collectDetailLabels(value: unknown, out: Map<string, unknown>) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectDetailLabels(entry, out);
    }
    return;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;

    if (typeof record.label === "string" && "value" in record) {
      if (!out.has(record.label)) {
        out.set(record.label, record.value);
      }
      return;
    }

    for (const entry of Object.values(record)) {
      collectDetailLabels(entry, out);
    }
  }
}

function parseApartmentSnapshot(snapshotJson: string, badges: string[]): InberlinwohnenItem | null {
  let snapshot: unknown;

  try {
    snapshot = JSON.parse(snapshotJson);
  } catch {
    return null;
  }

  const data = (snapshot as { data?: { item?: unknown } }).data;
  const item = firstElement(unwrapLivewire(data?.item));

  if (!item) {
    return null;
  }

  const flatId = typeof item.id === "number" ? item.id : null;
  const deeplink = asString(item.deeplink);

  if (flatId == null || !deeplink) {
    return null;
  }

  const address = firstElement(item.address);
  const company = firstElement(item.company);
  const details = new Map<string, unknown>();
  collectDetailLabels(item.details, details);

  const normalizedBadges = badges.map((badge) => badge.toLowerCase());
  const levelRaw = item.level;

  return {
    flatId,
    objectId: asString(item.objectId),
    title: asString(item.title) ?? `Wohnung ${flatId}`,
    deeplink,
    companyName: asString(company?.name),
    rooms: asNumber(item.rooms),
    sizeSqm: asNumber(item.area),
    rentCold: asNumber(item.rentNet),
    extraCosts: asNumber(item.extraCosts),
    rentWarm: asNumber(details.get("Gesamtmiete")) ?? asNumber(item.rentGross),
    availableFrom: parseGermanDate(item.occupationDate),
    postedAt: asString(item.createdAt),
    floor: typeof levelRaw === "number" ? levelRaw : null,
    floorsTotal: typeof item.levelsTotal === "number" ? item.levelsTotal : null,
    constructionYear: asString(item.constructionYear),
    wbs: asString(details.get("WBS")),
    street: asString(address?.street),
    houseNumber: asString(address?.number),
    zipCode: asString(address?.zipCode),
    district: asString(address?.district),
    latitude: asCoordinate(address?.lat),
    longitude: asCoordinate(address?.lon),
    hasBalcony: normalizedBadges.some((badge) => /balkon|loggia|terrasse/.test(badge)),
    hasElevator: normalizedBadges.some((badge) => /aufzug|fahrstuhl|lift/.test(badge)),
    badges,
    imagePath: asString(item.imagePath)
  };
}

export function parseInberlinwohnenSearchResults(html: string): InberlinwohnenItem[] {
  const $ = cheerio.load(html);
  const items: InberlinwohnenItem[] = [];

  $("[wire\\:snapshot]").each((_, element) => {
    const snapshotJson = $(element).attr("wire:snapshot");

    if (!snapshotJson || !snapshotJson.includes("apartment-finder.item.apartment-item")) {
      return;
    }

    // Equipment badges render as <span><i class="fa-..."></i> Label</span>.
    const badges = $(element)
      .find("span:has(i[class*='fa-'])")
      .map((__, span) => $(span).text().trim())
      .get()
      .filter((text) => text.length > 0 && text.length < 60);

    const parsed = parseApartmentSnapshot(snapshotJson, badges);

    if (parsed) {
      items.push(parsed);
    }
  });

  return items;
}

export function parseInberlinwohnenResultsCount(html: string): number | null {
  const match = html.match(/(\d+)\s*Angebote/);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function looksBlockedInberlinwohnenPage(html: string): boolean {
  const normalized = html.toLowerCase();
  return ["captcha", "access denied", "forbidden", "bot-detection", "cloudflare"].some((needle) =>
    normalized.includes(needle)
  );
}

export function looksLikeInberlinwohnenResultsPage(html: string): boolean {
  return html.includes("apartment-finder") || /Angebote/.test(html);
}
