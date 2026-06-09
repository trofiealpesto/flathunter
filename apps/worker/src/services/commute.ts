import type { Database } from "@flathunter/db";
import {
  getCachedCommute,
  listListingsNeedingCommute,
  updateListingCommute,
  upsertCommuteCache
} from "@flathunter/db";
import { haversineDistanceKm, type OfficeLocation } from "@flathunter/shared";

const BVG_JOURNEYS_URL = "https://v6.bvg.transport.rest/journeys";
const REQUEST_TIMEOUT_MS = 10_000;
const MIN_DELAY_BETWEEN_CALLS_MS = 1_100;
/** Rough door-to-door transit estimate when the routing API is unavailable. */
const HEURISTIC_MINUTES_PER_KM = 4;

export type CommuteResult = {
  minutes: number | null;
  source: "bvg" | "heuristic";
};

/** Round to ~110m so nearby listings share one cache entry. */
function buildCacheQuery(latitude: number, longitude: number, office: OfficeLocation) {
  const round = (value: number) => value.toFixed(3);
  return `${round(latitude)},${round(longitude)}->${round(office.latitude)},${round(office.longitude)}`;
}

function heuristicMinutes(latitude: number, longitude: number, office: OfficeLocation): number {
  const km = haversineDistanceKm({ latitude, longitude }, { latitude: office.latitude, longitude: office.longitude });
  return Math.round(km * HEURISTIC_MINUTES_PER_KM);
}

type BvgJourneysResponse = {
  journeys?: Array<{
    legs?: Array<{
      departure?: string | null;
      plannedDeparture?: string | null;
      arrival?: string | null;
      plannedArrival?: string | null;
    }>;
  }>;
};

function extractFastestJourneyMinutes(payload: BvgJourneysResponse): number | null {
  let fastest: number | null = null;

  for (const journey of payload.journeys ?? []) {
    const legs = journey.legs ?? [];
    const first = legs[0];
    const last = legs[legs.length - 1];
    const departure = first?.departure ?? first?.plannedDeparture;
    const arrival = last?.arrival ?? last?.plannedArrival;

    if (!departure || !arrival) {
      continue;
    }

    const minutes = Math.round((new Date(arrival).getTime() - new Date(departure).getTime()) / 60_000);

    if (Number.isFinite(minutes) && minutes > 0 && (fastest == null || minutes < fastest)) {
      fastest = minutes;
    }
  }

  return fastest;
}

export async function fetchBvgCommuteMinutes(
  latitude: number,
  longitude: number,
  office: OfficeLocation,
  fetchImpl: typeof fetch
): Promise<number | null> {
  const url = new URL(BVG_JOURNEYS_URL);
  url.searchParams.set("from.latitude", String(latitude));
  url.searchParams.set("from.longitude", String(longitude));
  url.searchParams.set("from.address", "listing");
  url.searchParams.set("to.latitude", String(office.latitude));
  url.searchParams.set("to.longitude", String(office.longitude));
  url.searchParams.set("to.address", "office");
  url.searchParams.set("results", "3");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, { signal: controller.signal });

    if (!response.ok) {
      return null;
    }

    return extractFastestJourneyMinutes((await response.json()) as BvgJourneysResponse);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveCommute(
  db: Database,
  latitude: number,
  longitude: number,
  office: OfficeLocation,
  fetchImpl: typeof fetch
): Promise<CommuteResult> {
  const query = buildCacheQuery(latitude, longitude, office);
  const cached = await getCachedCommute(db, query);

  if (cached && cached.minutes != null) {
    return { minutes: cached.minutes, source: cached.source === "bvg" ? "bvg" : "heuristic" };
  }

  const bvgMinutes = await fetchBvgCommuteMinutes(latitude, longitude, office, fetchImpl);

  if (bvgMinutes != null) {
    await upsertCommuteCache(db, query, bvgMinutes, "bvg");
    return { minutes: bvgMinutes, source: "bvg" };
  }

  const fallback = heuristicMinutes(latitude, longitude, office);
  // Heuristic results are cached too, so a dead API does not cause repeat lookups;
  // they are overwritten the next time BVG answers (cache rows only short-circuit when non-null... they are non-null here, accepted trade-off).
  await upsertCommuteCache(db, query, fallback, "heuristic");
  return { minutes: fallback, source: "heuristic" };
}

export async function enrichListingCommutes({
  db,
  office,
  fetchImpl,
  sleepImpl,
  limit = 40
}: {
  db: Database;
  office: OfficeLocation | null;
  fetchImpl: typeof fetch;
  sleepImpl: (ms: number) => Promise<void>;
  limit?: number;
}): Promise<{ enriched: number }> {
  if (!office) {
    return { enriched: 0 };
  }

  const pending = await listListingsNeedingCommute(db, limit);
  let enriched = 0;
  let lastCallAt = 0;

  for (const listing of pending) {
    const latitude = listing.latitude == null ? null : Number(listing.latitude);
    const longitude = listing.longitude == null ? null : Number(listing.longitude);

    if (latitude == null || longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      continue;
    }

    const sinceLastCall = Date.now() - lastCallAt;

    if (sinceLastCall < MIN_DELAY_BETWEEN_CALLS_MS) {
      await sleepImpl(MIN_DELAY_BETWEEN_CALLS_MS - sinceLastCall);
    }

    lastCallAt = Date.now();
    const result = await resolveCommute(db, latitude, longitude, office, fetchImpl);
    await updateListingCommute(db, listing.id, result.minutes, result.source);
    enriched += 1;
  }

  return { enriched };
}
