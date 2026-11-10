import { describe, expect, it } from "vitest";

import { listingFilterSchema } from "./listings";
import { berlinToday, effectiveMoveInDay, isIsoDay, matchesMoveInFilter, parseMoveInDate } from "./move-in";

describe("parseMoveInDate", () => {
  it.each([
    ["2026-12-01", "2026-12-01"],
    ["01.12.2026", "2026-12-01"],
    ["1.2.2027", "2027-02-01"],
    ["01.12.26", "2026-12-01"],
    ["Bezugsfertig ab 15.01.2027", "2027-01-15"],
    ["12/2026", "2026-12-01"],
    ["Dezember 2026", "2026-12-01"],
    ["März 2027", "2027-03-01"],
    ["Dez. 2026", "2026-12-01"],
    ["2027-01-01T00:00:00.000Z", "2027-01-01"]
  ])("reads %s as %s", (value, date) => {
    expect(parseMoveInDate(value)).toEqual({ kind: "date", date });
  });

  it.each(["sofort", "ab sofort", "Bezugsfrei ab sofort", "available immediately"])("reads %s as available now", (value) => {
    expect(parseMoveInDate(value)).toEqual({ kind: "now" });
  });

  it.each([null, "", "  ", "nach Vereinbarung", "ready_for_occupancy", "31.02.2026", "0026-10-20", "Mai"])(
    "returns null for %s",
    (value) => {
      expect(parseMoveInDate(value)).toBeNull();
    }
  );
});

describe("effectiveMoveInDay", () => {
  const today = "2026-11-10";

  it("keeps a future date", () => {
    expect(effectiveMoveInDay("2027-01-01", today)).toBe("2027-01-01");
  });

  it("collapses sofort and past dates to today", () => {
    expect(effectiveMoveInDay("sofort", today)).toBe(today);
    expect(effectiveMoveInDay("01.10.2026", today)).toBe(today);
  });

  it("returns null without a usable date", () => {
    expect(effectiveMoveInDay(null, today)).toBeNull();
  });
});

describe("matchesMoveInFilter", () => {
  const today = "2026-11-10";

  it("matches everything without a range", () => {
    expect(matchesMoveInFilter(null, {}, today)).toBe(true);
    expect(matchesMoveInFilter(null, { includeUnknownMoveIn: false }, today)).toBe(true);
  });

  it("keeps listings available by the latest day, including sofort", () => {
    const filter = { moveInBy: "2026-12-31" };
    expect(matchesMoveInFilter("sofort", filter, today)).toBe(true);
    expect(matchesMoveInFilter("01.12.2026", filter, today)).toBe(true);
    expect(matchesMoveInFilter("2026-12-31", filter, today)).toBe(true);
    expect(matchesMoveInFilter("2027-01-01", filter, today)).toBe(false);
  });

  it("drops listings available before the earliest day", () => {
    const filter = { moveInFrom: "2027-01-01" };
    expect(matchesMoveInFilter("sofort", filter, today)).toBe(false);
    expect(matchesMoveInFilter("2026-12-15", filter, today)).toBe(false);
    expect(matchesMoveInFilter("2027-01-01", filter, today)).toBe(true);
    expect(matchesMoveInFilter("Februar 2027", filter, today)).toBe(true);
  });

  it("applies both bounds", () => {
    const filter = { moveInFrom: "2026-12-01", moveInBy: "2027-01-31" };
    expect(matchesMoveInFilter("2026-12-15", filter, today)).toBe(true);
    expect(matchesMoveInFilter("2027-02-01", filter, today)).toBe(false);
  });

  it("drops unknown dates unless asked to keep them", () => {
    expect(matchesMoveInFilter(null, { moveInBy: "2026-12-31" }, today)).toBe(false);
    expect(matchesMoveInFilter("nach Vereinbarung", { moveInBy: "2026-12-31", includeUnknownMoveIn: true }, today)).toBe(true);
  });
});

describe("berlinToday", () => {
  it("uses the Berlin calendar day", () => {
    expect(berlinToday(new Date("2026-11-10T23:30:00Z"))).toBe("2026-11-11");
  });
});

describe("move-in query params", () => {
  it("accepts real days and booleans from the query string", () => {
    expect(
      listingFilterSchema.parse({ moveInFrom: "2026-12-01", moveInBy: "2027-01-31", includeUnknownMoveIn: "true" })
    ).toMatchObject({ moveInFrom: "2026-12-01", moveInBy: "2027-01-31", includeUnknownMoveIn: true });
  });

  it("rejects malformed days", () => {
    expect(isIsoDay("2026-02-30")).toBe(false);
    expect(listingFilterSchema.safeParse({ moveInBy: "01.12.2026" }).success).toBe(false);
    expect(listingFilterSchema.safeParse({ moveInBy: "2026-02-30" }).success).toBe(false);
  });
});
