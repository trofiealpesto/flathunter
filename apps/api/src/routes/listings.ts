import { z } from "zod";

import { getListingById, getSettings, listListings, updateListingLlmState, updateListingStatus } from "@flathunter/db";
import {
  formatRuntimeError,
  generateListingEnglishAnalyst,
  getLlmErrorKind,
  getRecommendedLlmTimeoutProfile,
  listingFilterSchema,
  listingStatusUpdateSchema
} from "@flathunter/shared";
import type { FastifyInstance } from "fastify";

import type { AppDeps } from "../app";
import { requireSession } from "../lib/session";

const idParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

export function registerListingRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get("/api/listings", async (request, reply) => {
    if (!requireSession(request, reply, deps.env)) {
      return;
    }

    const filters = listingFilterSchema.parse(request.query);
    return listListings(deps.db, filters);
  });

  app.get("/api/listings/:id", async (request, reply) => {
    if (!requireSession(request, reply, deps.env)) {
      return;
    }

    const { id } = idParamsSchema.parse(request.params);
    const listing = await getListingById(deps.db, id);

    if (!listing) {
      reply.code(404).send({
        message: "Listing not found"
      });
      return;
    }

    return listing;
  });

  app.post("/api/listings/:id/llm-analysis", async (request, reply) => {
    if (!requireSession(request, reply, deps.env)) {
      return;
    }

    const { id } = idParamsSchema.parse(request.params);
    const listing = await getListingById(deps.db, id);

    if (!listing) {
      reply.code(404).send({
        message: "Listing not found"
      });
      return;
    }

    const settings = await getSettings(deps.db);
    const timeouts = getRecommendedLlmTimeoutProfile(
      settings.runtime.llmClassifierModel,
      settings.runtime.llmAnalystModel
    );

    if (!settings.runtime.enableLlmEnrichment) {
      return listing;
    }

    try {
      const generated = await generateListingEnglishAnalyst(listing, settings, {
        apiKey: deps.env.GEMINI_API_KEY,
        baseUrl: deps.env.GEMINI_API_BASE_URL,
        classifierModel: settings.runtime.llmClassifierModel,
        analystModel: settings.runtime.llmAnalystModel,
        fetchImpl: deps.fetchImpl,
        analystTimeoutMs: timeouts.analystTimeoutMs
      });

      return updateListingLlmState(deps.db, id, {
        llmAnalysis: generated.llmAnalysis,
        llmLastErrorKind: null,
        llmLastErrorAt: null
      });
    } catch (error) {
      await updateListingLlmState(deps.db, id, {
        llmLastErrorKind: getLlmErrorKind(error),
        llmLastErrorAt: new Date()
      });

      reply.code(502).send({
        message: formatRuntimeError(error, "English analyst generation failed")
      });
      return;
    }
  });

  app.patch("/api/listings/:id/status", async (request, reply) => {
    if (!requireSession(request, reply, deps.env)) {
      return;
    }

    const { id } = idParamsSchema.parse(request.params);
    const payload = listingStatusUpdateSchema.parse(request.body);
    const listing = await updateListingStatus(deps.db, id, payload.userStatus);

    if (!listing) {
      reply.code(404).send({
        message: "Listing not found"
      });
      return;
    }

    return listing;
  });
}
