import type { ListingFilters } from "@flathunter/shared";

export type ListingViewTab = "all" | "new" | "match" | "contacted";

const filterKeys = [
  "portal",
  "userStatus",
  "eligibilityState",
  "maxRentWarm",
  "minSizeSqm",
  "minScore",
  "district",
  "query"
] as const;

export function filtersFromSearchParams(searchParams: URLSearchParams): ListingFilters {
  const next: ListingFilters = {};

  const portal = searchParams.get("portal");
  const userStatus = searchParams.get("userStatus");
  const eligibilityState = searchParams.get("eligibilityState");
  const district = searchParams.get("district");
  const query = searchParams.get("query");
  const maxRentWarm = searchParams.get("maxRentWarm");
  const minSizeSqm = searchParams.get("minSizeSqm");
  const minScore = searchParams.get("minScore");

  if (portal) {
    next.portal = portal as ListingFilters["portal"];
  }

  if (userStatus) {
    next.userStatus = userStatus as ListingFilters["userStatus"];
  }

  if (eligibilityState) {
    next.eligibilityState = eligibilityState as ListingFilters["eligibilityState"];
  }

  if (district) {
    next.district = district;
  }

  if (query) {
    next.query = query;
  }

  if (maxRentWarm) {
    next.maxRentWarm = Number(maxRentWarm);
  }

  if (minSizeSqm) {
    next.minSizeSqm = Number(minSizeSqm);
  }

  if (minScore) {
    next.minScore = Number(minScore);
  }

  return next;
}

export function hasActiveFilters(filters: ListingFilters) {
  return Object.values(filters).some((value) => value != null && value !== "");
}

export function mergeFilterSearchParams(
  currentSearchParams: URLSearchParams,
  patch: Partial<ListingFilters>
) {
  const nextSearchParams = new URLSearchParams(currentSearchParams);

  Object.entries(patch).forEach(([key, value]) => {
    if (value == null || value === "") {
      nextSearchParams.delete(key);
    } else {
      nextSearchParams.set(key, String(value));
    }
  });

  return nextSearchParams;
}

export function resetFilterSearchParams(currentSearchParams: URLSearchParams) {
  const nextSearchParams = new URLSearchParams(currentSearchParams);

  filterKeys.forEach((key) => nextSearchParams.delete(key));

  return nextSearchParams;
}

export function getListingViewTab(filters: ListingFilters): ListingViewTab {
  if (filters.userStatus === "CONTACTED") {
    return "contacted";
  }

  if (filters.eligibilityState === "MATCH") {
    return "match";
  }

  if (filters.userStatus === "NEW") {
    return "new";
  }

  return "all";
}

export function applyListingViewTab(currentSearchParams: URLSearchParams, tab: ListingViewTab) {
  const nextSearchParams = new URLSearchParams(currentSearchParams);

  nextSearchParams.delete("userStatus");
  nextSearchParams.delete("eligibilityState");

  if (tab === "new") {
    nextSearchParams.set("userStatus", "NEW");
  }

  if (tab === "match") {
    nextSearchParams.set("eligibilityState", "MATCH");
  }

  if (tab === "contacted") {
    nextSearchParams.set("userStatus", "CONTACTED");
  }

  return nextSearchParams;
}
