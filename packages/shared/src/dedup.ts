import { haversineDistanceKm } from "./geo";
import type { Portal } from "./listings";

export type DedupCandidate = {
  id: number;
  portal: Portal;
  rentCold: number | null;
  rentWarm: number | null;
  sizeSqm: number | null;
  rooms: number | null;
  latitude: number | null;
  longitude: number | null;
  addressLine: string | null;
  firstSeenAt: string;
};

const MAX_SIZE_DELTA_SQM = 1;
const MAX_RENT_DELTA_EUR = 15;
const MAX_DISTANCE_KM = 0.25;

function extractPostalCode(addressLine: string | null): string | null {
  return addressLine?.match(/\b(\d{5})\b/)?.[1] ?? null;
}

function comparableRent(listing: DedupCandidate): number | null {
  return listing.rentWarm ?? listing.rentCold;
}

/**
 * Conservative cross-portal duplicate check. Both listings must have size,
 * rooms and a comparable rent — missing data never matches. Location agrees
 * via coordinates (<250m) or an identical postal code.
 */
export function listingsLookLikeDuplicates(left: DedupCandidate, right: DedupCandidate): boolean {
  if (left.portal === right.portal) {
    return false;
  }

  if (left.sizeSqm == null || right.sizeSqm == null || Math.abs(left.sizeSqm - right.sizeSqm) > MAX_SIZE_DELTA_SQM) {
    return false;
  }

  if (left.rooms == null || right.rooms == null || left.rooms !== right.rooms) {
    return false;
  }

  const leftRent = comparableRent(left);
  const rightRent = comparableRent(right);

  if (leftRent == null || rightRent == null || Math.abs(leftRent - rightRent) > MAX_RENT_DELTA_EUR) {
    return false;
  }

  if (left.latitude != null && left.longitude != null && right.latitude != null && right.longitude != null) {
    const distanceKm = haversineDistanceKm(
      { latitude: left.latitude, longitude: left.longitude },
      { latitude: right.latitude, longitude: right.longitude }
    );

    if (distanceKm < MAX_DISTANCE_KM) {
      return true;
    }
  }

  const leftPostal = extractPostalCode(left.addressLine);
  const rightPostal = extractPostalCode(right.addressLine);

  return leftPostal != null && leftPostal === rightPostal;
}

/**
 * Pairs each listing with its earliest-seen duplicate. Returns
 * { duplicateId → originalId } where the original is the older listing.
 */
export function findDuplicatePairs(candidates: DedupCandidate[]): Map<number, number> {
  const assignments = new Map<number, number>();
  const sorted = [...candidates].sort(
    (a, b) => new Date(a.firstSeenAt).getTime() - new Date(b.firstSeenAt).getTime()
  );

  for (let i = 0; i < sorted.length; i += 1) {
    const original = sorted[i];

    // A listing already flagged as duplicate cannot be an original.
    if (assignments.has(original.id)) {
      continue;
    }

    for (let j = i + 1; j < sorted.length; j += 1) {
      const later = sorted[j];

      if (assignments.has(later.id)) {
        continue;
      }

      if (listingsLookLikeDuplicates(original, later)) {
        assignments.set(later.id, original.id);
      }
    }
  }

  return assignments;
}
