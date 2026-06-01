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

export function computeDeterministicScore(
  listing: Partial<ListingUpsertInput>,
  settings: AppSettings,
  analysisFlags: AnalysisFlag[] = []
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

  return clamp(score, 0, 100);
}
