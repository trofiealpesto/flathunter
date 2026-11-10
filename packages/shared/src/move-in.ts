/**
 * Portals publish the move-in date as free text ("2026-12-01", "01.12.2026",
 * "Dezember 2026", "ab sofort"). These helpers read it into a calendar day so
 * listings can be filtered by when the user could actually move in.
 */
export type MoveInDate = { kind: "now" } | { kind: "date"; date: string };

export type MoveInFilter = {
  moveInFrom?: string;
  moveInBy?: string;
  includeUnknownMoveIn?: boolean;
};

const AVAILABLE_NOW = /\bsofort\b|\bimmediately\b|\bab jetzt\b|\bavailable now\b|\bright away\b/i;

const MONTHS: Record<string, number> = {
  jan: 1, januar: 1, january: 1,
  feb: 2, februar: 2, february: 2,
  mär: 3, maer: 3, mar: 3, märz: 3, maerz: 3, march: 3,
  apr: 4, april: 4,
  mai: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oct: 10, oktober: 10, october: 10,
  nov: 11, november: 11,
  dez: 12, dec: 12, dezember: 12, december: 12
};

const berlinDayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" });

/** Today's calendar day in Berlin as "YYYY-MM-DD". */
export function berlinToday(now = new Date()) {
  return berlinDayFormat.format(now);
}

function isoDay(year: number, month: number, day: number): string | null {
  if (year < 2000 || year > 2100) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

/** True for a real calendar day written as "YYYY-MM-DD". */
export function isIsoDay(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match != null && isoDay(Number(match[1]), Number(match[2]), Number(match[3])) === value;
}

export function parseMoveInDate(value: string | null | undefined): MoveInDate | null {
  const text = value?.trim().toLowerCase();

  if (!text) {
    return null;
  }

  const date = parseExplicitDate(text);

  if (date) {
    return { kind: "date", date };
  }

  return AVAILABLE_NOW.test(text) ? { kind: "now" } : null;
}

function parseExplicitDate(text: string): string | null {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})(?!\d)/);

  if (iso) {
    return isoDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const german = text.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})\b/);

  if (german) {
    const year = german[3].length === 2 ? 2000 + Number(german[3]) : Number(german[3]);
    return isoDay(year, Number(german[2]), Number(german[1]));
  }

  const monthYear = text.match(/\b(\d{1,2})[./](\d{4})\b/);

  if (monthYear) {
    return isoDay(Number(monthYear[2]), Number(monthYear[1]), 1);
  }

  const named = text.match(/\b([a-zäö]+)\.?\s+(\d{4})\b/);
  const month = named ? MONTHS[named[1]] : undefined;

  return named && month ? isoDay(Number(named[2]), month, 1) : null;
}

/**
 * Earliest day the user could move in, seen from `today`: "sofort" and dates
 * already in the past both mean today. Null when the portal gave no usable date.
 */
export function effectiveMoveInDay(availableFrom: string | null | undefined, today: string): string | null {
  const parsed = parseMoveInDate(availableFrom);

  if (!parsed) {
    return null;
  }

  if (parsed.kind === "now" || parsed.date < today) {
    return today;
  }

  return parsed.date;
}

export function hasMoveInFilter(filter: MoveInFilter) {
  return Boolean(filter.moveInFrom || filter.moveInBy);
}

export function matchesMoveInFilter(availableFrom: string | null | undefined, filter: MoveInFilter, today: string) {
  if (!hasMoveInFilter(filter)) {
    return true;
  }

  const day = effectiveMoveInDay(availableFrom, today);

  if (!day) {
    return filter.includeUnknownMoveIn === true;
  }

  if (filter.moveInFrom && day < filter.moveInFrom) {
    return false;
  }

  return !(filter.moveInBy && day > filter.moveInBy);
}
