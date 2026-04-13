import { getCachedGeoSearch, upsertGeoSearchCache } from "@flathunter/db";
import { geoSearchResultSchema } from "@flathunter/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { AppDeps } from "../app";
import { requireSession } from "../lib/session";

const geoSearchBodySchema = z.object({
  query: z.string().trim().min(3).max(200)
});

const nominatimRecordSchema = z.object({
  display_name: z.string(),
  lat: z.string(),
  lon: z.string(),
  address: z
    .object({
      suburb: z.string().optional(),
      borough: z.string().optional(),
      city_district: z.string().optional(),
      quarter: z.string().optional(),
      neighbourhood: z.string().optional()
    })
    .passthrough()
    .optional()
});

const geoCacheTtlMs = 1000 * 60 * 60 * 24 * 30;
let lastRemoteLookupAt = 0;

function normalizeOfficeQuery(query: string) {
  return /berlin/i.test(query) ? query : `${query}, Berlin, Germany`;
}

function pickDistrict(address: z.infer<typeof nominatimRecordSchema>["address"]) {
  if (!address) {
    return null;
  }

  return address.suburb ?? address.borough ?? address.city_district ?? address.quarter ?? address.neighbourhood ?? null;
}

function buildResultLabel(displayName: string) {
  return (
    displayName
      .split(",")
      .slice(0, 2)
      .join(", ")
      .replace(/\s+/g, " ")
      .trim() || displayName
  );
}

async function waitForThrottleWindow() {
  const now = Date.now();
  const elapsed = now - lastRemoteLookupAt;

  if (elapsed < 1100) {
    await new Promise((resolve) => setTimeout(resolve, 1100 - elapsed));
  }

  lastRemoteLookupAt = Date.now();
}

export function registerGeoRoutes(app: FastifyInstance, deps: AppDeps) {
  app.post("/api/geo/search", async (request, reply) => {
    if (!requireSession(request, reply, deps.env)) {
      return;
    }

    const { query } = geoSearchBodySchema.parse(request.body);
    const cached = await getCachedGeoSearch(deps.db, query);

    if (cached) {
      const ageMs = Date.now() - new Date(cached.updatedAt).getTime();

      if (ageMs < geoCacheTtlMs) {
        return cached.results;
      }
    }

    await waitForThrottleWindow();

    const url = new URL("/search", deps.env.NOMINATIM_BASE_URL);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "5");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("countrycodes", "de");
    url.searchParams.set("q", normalizeOfficeQuery(query));

    const response = await deps.fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "Accept-Language": "en,de",
        "User-Agent": `FlatHunter/1.0 (${deps.env.APP_ORIGIN})`
      }
    });

    if (!response.ok) {
      reply.code(502).send({
        message: "Office geocoding request failed"
      });
      return;
    }

    const payload = z.array(nominatimRecordSchema).parse(await response.json());
    const results = payload.map((item) =>
      geoSearchResultSchema.parse({
        label: buildResultLabel(item.display_name),
        address: item.display_name,
        district: pickDistrict(item.address),
        latitude: Number(item.lat),
        longitude: Number(item.lon),
        provider: "nominatim"
      })
    );

    await upsertGeoSearchCache(deps.db, query, results);
    return results;
  });
}
