import { z } from "zod";

import { createContactAttempt, getListingById, getSettings, listContactAttemptsByListing } from "@flathunter/db";
import {
  contactAttemptCreateSchema,
  formatRuntimeError,
  generateApplicationMessage,
  getRecommendedLlmTimeoutProfile
} from "@flathunter/shared";
import type { FastifyInstance } from "fastify";

import type { AppDeps } from "../app";
import { requireSession } from "../lib/session";

const idParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

export function registerContactRoutes(app: FastifyInstance, deps: AppDeps) {
  app.post("/api/listings/:id/contact-message", async (request, reply) => {
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

    try {
      // Draft only — nothing is persisted until the user marks the attempt as sent.
      return await generateApplicationMessage(listing, settings, {
        apiKey: deps.env.GEMINI_API_KEY,
        baseUrl: deps.env.GEMINI_API_BASE_URL,
        classifierModel: settings.runtime.llmAnalystModel,
        analystModel: settings.runtime.llmAnalystModel,
        fetchImpl: deps.fetchImpl,
        analystTimeoutMs: timeouts.analystTimeoutMs
      });
    } catch (error) {
      reply.code(502).send({
        message: formatRuntimeError(error, "Contact message generation failed")
      });
      return;
    }
  });

  app.post("/api/listings/:id/contact-attempts", async (request, reply) => {
    if (!requireSession(request, reply, deps.env)) {
      return;
    }

    const { id } = idParamsSchema.parse(request.params);
    const payload = contactAttemptCreateSchema.parse(request.body);
    const attempt = await createContactAttempt(deps.db, id, payload);

    if (!attempt) {
      reply.code(404).send({
        message: "Listing not found"
      });
      return;
    }

    reply.code(201);
    return attempt;
  });

  app.get("/api/listings/:id/contact-attempts", async (request, reply) => {
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

    return listContactAttemptsByListing(deps.db, id);
  });
}
