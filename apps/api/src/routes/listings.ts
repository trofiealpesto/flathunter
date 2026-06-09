import { z } from "zod";

import { getListingById, getSettings, listListings, updateListingEvaluation, updateListingLlmState, updateListingStatus } from "@flathunter/db";
import {
  classifyListingEligibility,
  evaluateListingDeterministically,
  formatRuntimeError,
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
      settings.runtime.llmAnalystModel,
      settings.runtime.llmAnalystModel
    );

    if (!settings.runtime.enableLlmEnrichment) {
      return listing;
    }

    // Re-evaluate deterministically to get context for the LLM call.
    const deterministic = evaluateListingDeterministically(listing, settings, {
      commuteMinutes: listing.commuteMinutes,
      firstSeenAt: listing.firstSeenAt
    });

    try {
      // Single unified call: produces eligibility verdict + translation + summary.
      // Uses the analyst model on-demand for best quality.
      const evaluation = await classifyListingEligibility(listing, settings, {
        deterministicScore: deterministic.score,
        deterministicReason: deterministic.reason,
        analysisFlags: deterministic.analysisFlags
      }, {
        apiKey: deps.env.GEMINI_API_KEY,
        baseUrl: deps.env.GEMINI_API_BASE_URL,
        classifierModel: settings.runtime.llmAnalystModel,
        analystModel: settings.runtime.llmAnalystModel,
        fetchImpl: deps.fetchImpl,
        timeoutMs: timeouts.analystTimeoutMs,
        allowClassifierFallback: false
      });

      // If the LLM was unavailable, surface the error the same way as before.
      if (evaluation.usedFallback && evaluation.errorKind) {
        await updateListingLlmState(deps.db, id, {
          llmLastErrorKind: evaluation.errorKind,
          llmLastErrorAt: new Date()
        });

        reply.code(502).send({
          message: `Listing evaluation failed: ${evaluation.errorKind.replace(/_/g, " ")}`
        });
        return;
      }

      // Persist both the updated verdict and the analysis.
      return updateListingEvaluation(deps.db, id, {
        score: deterministic.score,
        eligibilityState: evaluation.eligibilityState,
        eligibilityReason: evaluation.reason,
        analysisFlags: deterministic.analysisFlags,
        semanticFlags: evaluation.flags,
        semanticModel: evaluation.model,
        semanticFitScore: evaluation.fitScore ?? null,
        semanticInputFingerprint: evaluation.inputFingerprint,
        semanticUpdatedAt: new Date(),
        semanticLastErrorKind: null,
        semanticLastErrorAt: null,
        llmAnalysis: evaluation.llmAnalysis,
        llmLastErrorKind: null,
        llmLastErrorAt: null
      });
    } catch (error) {
      await updateListingLlmState(deps.db, id, {
        llmLastErrorKind: getLlmErrorKind(error),
        llmLastErrorAt: new Date()
      });

      reply.code(502).send({
        message: formatRuntimeError(error, "Listing evaluation failed")
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
