import type { ListingDetail } from "@flathunter/shared";

export function getListingPrimaryAction(listing: ListingDetail, isFixtureMode: boolean, fallbackSearchUrl: string | null) {
  if (listing.sourceMode === "fixture" || (listing.sourceMode == null && isFixtureMode)) {
    return {
      label: "Open portal search",
      url: fallbackSearchUrl ?? listing.url,
      helperText:
        "Fixture listings use synthetic expose URLs, so the action opens the configured portal search instead."
    };
  }

  return {
    label: "View original listing",
    url: listing.url,
    helperText: null
  };
}
