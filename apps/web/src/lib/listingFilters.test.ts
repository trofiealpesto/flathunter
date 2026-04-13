import { describe, expect, it } from "vitest";

import { applyListingViewTab, filtersFromSearchParams, getListingViewTab, mergeFilterSearchParams, resetFilterSearchParams } from "./listingFilters";

describe("listingFilters helpers", () => {
  it("parses listing filters from URL search params", () => {
    const filters = filtersFromSearchParams(
      new URLSearchParams("portal=IMMOWELT&query=quiet&maxRentWarm=1800&minScore=60&district=Mitte")
    );

    expect(filters).toEqual({
      portal: "IMMOWELT",
      query: "quiet",
      maxRentWarm: 1800,
      minScore: 60,
      district: "Mitte"
    });
  });

  it("merges and resets filter search params", () => {
    const current = new URLSearchParams("query=quiet&portal=IMMOWELT");
    const merged = mergeFilterSearchParams(current, {
      portal: undefined,
      minScore: 80
    });

    expect(merged.toString()).toBe("query=quiet&minScore=80");
    expect(resetFilterSearchParams(merged).toString()).toBe("");
  });

  it("maps between listing tabs and filter params", () => {
    expect(getListingViewTab({ eligibilityState: "MATCH" })).toBe("match");
    expect(applyListingViewTab(new URLSearchParams("district=Mitte"), "contacted").toString()).toBe(
      "district=Mitte&userStatus=CONTACTED"
    );
  });
});
