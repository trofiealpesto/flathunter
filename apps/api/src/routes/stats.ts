import { getDashboardStats, getStatsSummary } from "@flathunter/db";
import type { FastifyInstance } from "fastify";

import type { AppDeps } from "../app";
import { requireSession } from "../lib/session";

export function registerStatsRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get("/api/stats/summary", async (request, reply) => {
    if (!requireSession(request, reply, deps.env)) {
      return;
    }

    return getStatsSummary(deps.db);
  });

  app.get("/api/stats/dashboard", async (request, reply) => {
    if (!requireSession(request, reply, deps.env)) {
      return;
    }

    return getDashboardStats(deps.db, {
      llmProviderConfigured: Boolean(deps.env.GEMINI_API_KEY?.trim())
    });
  });
}
