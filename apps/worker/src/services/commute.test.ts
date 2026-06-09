import { describe, expect, it, vi } from "vitest";

import type { OfficeLocation } from "@flathunter/shared";

import { fetchBvgCommuteMinutes } from "./commute";

const office: OfficeLocation = {
  label: "Office",
  address: "Alexanderplatz 1, Berlin",
  latitude: 52.5219,
  longitude: 13.4132,
  district: "Mitte",
  provider: "nominatim",
  updatedAt: new Date().toISOString()
};

function journeysResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

describe("fetchBvgCommuteMinutes", () => {
  it("returns the fastest journey duration in minutes", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      journeysResponse({
        journeys: [
          {
            legs: [
              { departure: "2026-06-09T08:00:00+02:00", arrival: "2026-06-09T08:20:00+02:00" },
              { departure: "2026-06-09T08:22:00+02:00", arrival: "2026-06-09T08:42:00+02:00" }
            ]
          },
          {
            legs: [{ departure: "2026-06-09T08:05:00+02:00", arrival: "2026-06-09T08:33:00+02:00" }]
          }
        ]
      })
    );

    const minutes = await fetchBvgCommuteMinutes(52.49, 13.52, office, fetchImpl);

    expect(minutes).toBe(28);
    const requestedUrl = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(requestedUrl.searchParams.get("from.latitude")).toBe("52.49");
    expect(requestedUrl.searchParams.get("to.latitude")).toBe(String(office.latitude));
  });

  it("returns null on HTTP errors and network failures", async () => {
    const failing = vi.fn<typeof fetch>().mockResolvedValue(new Response("nope", { status: 502 }));
    expect(await fetchBvgCommuteMinutes(52.49, 13.52, office, failing)).toBeNull();

    const throwing = vi.fn<typeof fetch>().mockRejectedValue(new Error("network down"));
    expect(await fetchBvgCommuteMinutes(52.49, 13.52, office, throwing)).toBeNull();
  });

  it("ignores journeys with missing leg timestamps", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      journeysResponse({
        journeys: [{ legs: [{ departure: null, arrival: null }] }]
      })
    );

    expect(await fetchBvgCommuteMinutes(52.49, 13.52, office, fetchImpl)).toBeNull();
  });
});
