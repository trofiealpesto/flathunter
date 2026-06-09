import type { AppSettings } from "./settings";
import type { AnalysisFlag, ListingUpsertInput } from "./listings";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const normalizeDistrict = (value: string) => value.trim().toLowerCase();

export function canonicalizeListingUrl(input: string): string {
  try {
    const url = new URL(input);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return input;
  }
}

export type ScoringContext = {
  /** Door-to-door transit minutes to the office, when known. */
  commuteMinutes?: number | null;
  /** ISO timestamp of when the listing was first ingested. */
  firstSeenAt?: string | null;
  /** Median EUR per sqm for the listing's district over recent listings. */
  districtMedianRentPerSqm?: number | null;
  /** Injection point for tests; defaults to the current time. */
  now?: Date;
};

const FRESHNESS_BONUS_24H = 8;
const FRESHNESS_BONUS_72H = 4;
const PRICE_BASELINE_MAX_POINTS = 8;

export function computeDeterministicScore(
  listing: Partial<ListingUpsertInput>,
  settings: AppSettings,
  analysisFlags: AnalysisFlag[] = [],
  context: ScoringContext = {}
): number {
  let score = 50;

  if (listing.rentWarm != null) {
    const delta = settings.scoring.maxWarmRent - listing.rentWarm;
    score += Math.round(delta / 40);
  }

  if (listing.sizeSqm != null) {
    score += Math.round((listing.sizeSqm - settings.scoring.minimumSizeSqm) / 2);
  }

  if (listing.rooms != null) {
    score += Math.round((listing.rooms - settings.scoring.minimumRooms) * 8);
  }

  if (listing.hasBalcony) {
    score += settings.scoring.balconyBonus;
  }

  if (listing.hasElevator) {
    score += settings.scoring.elevatorBonus;
  }

  if (listing.isFurnished) {
    score -= settings.scoring.furnishedPenalty;
  }

  if (
    listing.district &&
    settings.scoring.preferredDistricts.some((district) => normalizeDistrict(district) === normalizeDistrict(listing.district ?? ""))
  ) {
    score += 10;
  }

  if (analysisFlags.includes("long_term")) {
    score += 6;
  }

  // couple_friendly is not a user preference and was removed as a scoring signal to avoid bias.

  if (!listing.isFurnished && analysisFlags.includes("furnished_text")) {
    score -= 4;
  }

  if (analysisFlags.includes("temporary_sublet")) {
    score -= 18;
  }

  if (analysisFlags.includes("room_only")) {
    score -= 25;
  }

  if (analysisFlags.includes("swap_only")) {
    score -= 40;
  }

  if (analysisFlags.includes("wbs_required")) {
    score -= 35;
  }

  if (context.commuteMinutes != null && context.commuteMinutes > settings.scoring.maxCommuteMinutes) {
    const excess = context.commuteMinutes - settings.scoring.maxCommuteMinutes;
    score -= Math.round((excess / 10) * settings.scoring.commutePenaltyPerTenMinutes);
  }

  if (context.firstSeenAt) {
    const firstSeen = new Date(context.firstSeenAt).getTime();

    if (Number.isFinite(firstSeen)) {
      const ageHours = ((context.now ?? new Date()).getTime() - firstSeen) / 3_600_000;

      if (ageHours < 24) {
        score += FRESHNESS_BONUS_24H;
      } else if (ageHours < 72) {
        score += FRESHNESS_BONUS_72H;
      }
    }
  }

  const rentForBaseline = listing.rentCold ?? listing.rentWarm;

  if (context.districtMedianRentPerSqm != null && context.districtMedianRentPerSqm > 0 && rentForBaseline != null && listing.sizeSqm) {
    const rentPerSqm = rentForBaseline / listing.sizeSqm;
    // 1 point per 5% deviation from the district median, capped at ±8.
    // Cheaper than the median raises the score, more expensive lowers it.
    const deviation = (context.districtMedianRentPerSqm - rentPerSqm) / context.districtMedianRentPerSqm;
    score += clamp(Math.round(deviation * 20), -PRICE_BASELINE_MAX_POINTS, PRICE_BASELINE_MAX_POINTS);
  }

  return clamp(score, 0, 100);
}
