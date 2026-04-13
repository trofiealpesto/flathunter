import type { ListingDetail, ListingSummary } from "@flathunter/shared";

export function formatDistance(distanceKm: number | null | undefined) {
  if (distanceKm == null) {
    return "n/a";
  }

  return `${distanceKm.toFixed(1)} km`;
}

export function getGeoSourceLabel(source: ListingSummary["geoSource"] | ListingDetail["geoSource"]) {
  if (source === "portal_coordinates") {
    return "Portal coordinates";
  }

  if (source === "district_centroid") {
    return "District centroid";
  }

  return "Unknown";
}

export function getEligibilityTone(
  eligibilityState: ListingSummary["eligibilityState"] | ListingDetail["eligibilityState"]
) {
  if (eligibilityState === "MATCH") {
    return "#1f8f4e";
  }

  if (eligibilityState === "REJECT") {
    return "#cc2f32";
  }

  return "#d97706";
}
