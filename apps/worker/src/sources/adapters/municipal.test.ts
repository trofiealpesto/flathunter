import { readFile } from "node:fs/promises";
import { defaultAppSettings, municipalSourceUrls } from "@flathunter/shared";
import { describe, expect, it, vi } from "vitest";
import { readWorkerEnv } from "../../config";
import { gewobagAdapter, howogeAdapter, parseGewobagPage, parseHowogeFeed } from "./municipal";
import type { SourceAdapterContext } from "../types";

const howogeFixture = JSON.parse(await readFile(new URL("../../fixtures/howoge/search.json", import.meta.url), "utf8"));
const gewobagFixture = await readFile(new URL("../../fixtures/gewobag/search.html", import.meta.url), "utf8");
function context(portal: "HOWOGE" | "GEWOBAG", fetchImpl = vi.fn<typeof fetch>()): SourceAdapterContext {
  return {
    env: readWorkerEnv({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://unused",
      PORTAL_SECRETS_KEY: "test-portal-secret",
    }),
    settings: defaultAppSettings,
    searchUrl: municipalSourceUrls[portal],
    searchParams: {},
    scrapeWithFixtures: false,
    sessionState: null,
    credentials: null,
    fetchImpl,
  };
}

describe("municipal sources", () => {
  it("maps HOWOGE warm rent, coordinates, WBS and images without inventing project listings", () => {
    const parsed = parseHowogeFeed({ ...howogeFixture, teasercount: 100, immocount: 103 });
    expect(parsed.listings).toHaveLength(3);
    expect(parsed.missing).toBe(0);
    expect(parsed.listings[0]).toMatchObject({
      portal: "HOWOGE",
      rentWarm: 803,
      rentCold: null,
      rooms: 3,
      sizeSqm: 73,
      city: "Berlin",
      latitude: 52.5575599,
      longitude: 13.209115,
      hasElevator: true,
    });
    expect(parsed.listings[0]?.description).toContain("WBS erforderlich");
    expect(parsed.listings[0]?.rawPayload?.search).toMatchObject({
      coverImageUrl: expect.stringContaining("https://www.howoge.de/"),
    });
  });

  it("rejects changed feed shapes and counts invalid items instead of reporting an empty success", () => {
    expect(() => parseHowogeFeed({ results: [] })).toThrow();
    const parsed = parseHowogeFeed({
      ...howogeFixture,
      immoobjects: [null, { ...howogeFixture.immoobjects[0], link: "https://evil.test/flat" }],
    });
    expect(parsed.invalid).toBe(2);
    expect(parsed.missing).toBe(1);
    expect(parsed.listings).toEqual([]);
  });

  it("distinguishes an empty valid feed from a failed request and honors HOWOGE search filters", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ immocount: 0, teasercount: 0, immoobjects: [] })));
    const ctx = context("HOWOGE", fetchImpl);
    ctx.searchUrl += "?tx_howrealestate_json_list%5Bwbs%5D=no";
    const result = await howogeAdapter.scrape(ctx);
    expect(result.failedDetails).toBe(0);
    expect(result.listings).toEqual([]);
    expect(fetchImpl.mock.calls[0]?.[1]?.body?.toString()).toContain("%5Bwbs%5D=no");
    fetchImpl.mockResolvedValue(new Response("unavailable", { status: 503 }));
    await expect(howogeAdapter.scrape(ctx)).rejects.toThrow("503");
  });

  it("flags incomplete HOWOGE coverage and filters offers outside the search city", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ ...howogeFixture, immocount: 8 })));
    const result = await howogeAdapter.scrape(context("HOWOGE", fetchImpl));
    expect(result.listings).toHaveLength(2);
    expect(result.failedDetails).toBe(1);
    expect(result.authError).toContain("5 individual listings missing");
  });

  it("parses Gewobag German prices, rooms, district, WBS and availability", () => {
    const parsed = parseGewobagPage(gewobagFixture.replace("Wohnung ab sofort verfügbar", "WBS 100 erforderlich"));
    expect(parsed.invalid).toBe(0);
    expect(parsed.listings[0]).toMatchObject({
      portal: "GEWOBAG",
      portalListingId: "0100-01922-0106-0210",
      rentWarm: 799.76,
      rentCold: null,
      sizeSqm: 58.74,
      rooms: 2,
      city: "Berlin",
      district: "Spandau",
      neighborhood: "Staaken",
      hasBalcony: true,
      hasElevator: true,
      availableFrom: "23.09.2026",
    });
    expect(parsed.listings[0]?.description).toContain("WBS 100 erforderlich");
    expect(parseGewobagPage(gewobagFixture.replace("Gesamtmiete", "Kaltmiete")).listings[0]?.rentWarm).toBeNull();
    expect(() => parseGewobagPage("<h1>Access denied</h1>")).toThrow();
    expect(parseGewobagPage('<div class="filtered-mietangebote"></div>').listings).toEqual([]);
  });

  it("follows Gewobag pagination and deduplicates repeated cards", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          gewobagFixture +
            '<a class="next page-numbers" href="/fuer-mietinteressentinnen/suche/wohnung/page/2/">Next</a>',
        ),
      )
      .mockResolvedValueOnce(new Response(gewobagFixture));
    const result = await gewobagAdapter.scrape(context("GEWOBAG", fetchImpl));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.listings).toHaveLength(1);
    expect(result.failedDetails).toBe(0);
  });

  it("preserves earlier listings and reports a failed subsequent page as partial", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          gewobagFixture +
            '<a class="next page-numbers" href="/fuer-mietinteressentinnen/suche/wohnung/page/2/">Next</a>',
        ),
      )
      .mockResolvedValueOnce(new Response("blocked", { status: 429 }));
    const result = await gewobagAdapter.scrape(context("GEWOBAG", fetchImpl));
    expect(result.listings).toHaveLength(1);
    expect(result.failedDetails).toBe(1);
    expect(result.authError).toContain("429");
  });

  it("does not follow external pagination or repeated next-page links", async () => {
    for (const next of ["https://evil.test/", municipalSourceUrls.GEWOBAG]) {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(gewobagFixture + `<a class="next page-numbers" href="${next}">Next</a>`));
      const result = await gewobagAdapter.scrape(context("GEWOBAG", fetchImpl));
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(result.failedDetails).toBe(1);
    }
  });

  it("supports fixture mode without network calls", async () => {
    for (const adapter of [howogeAdapter, gewobagAdapter]) {
      const fetchImpl = vi.fn<typeof fetch>();
      const result = await adapter.scrape({
        ...context(adapter.portal as "HOWOGE" | "GEWOBAG", fetchImpl),
        scrapeWithFixtures: true,
      });
      expect(result.mode).toBe("fixture");
      expect(result.listings.length).toBeGreaterThan(0);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(result.listings[0]?.rawPayload?.source).toBe("fixture");
    }
  });

  it("follows same-site redirects but refuses redirects to external hosts", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { location: "/fuer-mietinteressentinnen/mietangebote/?objekttyp%5B0%5D=wohnung" },
        }),
      )
      .mockResolvedValueOnce(new Response(gewobagFixture));
    expect((await gewobagAdapter.scrape(context("GEWOBAG", fetchImpl))).listings).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    fetchImpl
      .mockReset()
      .mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://external.test/" } }));
    await expect(gewobagAdapter.scrape(context("GEWOBAG", fetchImpl))).rejects.toThrow("outside the official site");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
