import { describe, expect, it } from "vitest";
import { listingFilterSchema } from "./listings";

describe("listing query validation", () => {
  it("does not turn the query string false into true", () => {
    expect(listingFilterSchema.parse({ includeDuplicates: "false" }).includeDuplicates).toBe(false);
    expect(listingFilterSchema.parse({ includeDuplicates: "true" }).includeDuplicates).toBe(true);
    expect(listingFilterSchema.safeParse({ includeDuplicates: "yes" }).success).toBe(false);
  });
  it("accepts municipal sources and rejects invalid room/freshness limits", () => {
    expect(listingFilterSchema.parse({ portal: "HOWOGE", minRooms: "2.5", seenWithinDays: "7" })).toMatchObject({
      portal: "HOWOGE",
      minRooms: 2.5,
      seenWithinDays: 7,
    });
    expect(listingFilterSchema.parse({ portal: "GEWOBAG" }).portal).toBe("GEWOBAG");
    for (const value of ["0", "-1", "1.5", "366", "Infinity"]) {
      expect(listingFilterSchema.safeParse({ seenWithinDays: value }).success).toBe(false);
    }
    expect(listingFilterSchema.safeParse({ minRooms: "-1" }).success).toBe(false);
  });
});
