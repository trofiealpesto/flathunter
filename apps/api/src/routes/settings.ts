import { getSettings, patchSettings } from "@flathunter/db";
import { appSettingsPatchSchema } from "@flathunter/shared";
import type { FastifyInstance } from "fastify";

import type { AppDeps } from "../app";
import { requireSession } from "../lib/session";

export function registerSettingsRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get("/api/settings", async (request, reply) => {
    if (!requireSession(request, reply, deps.env)) {
      return;
    }

    return getSettings(deps.db);
  });

  app.patch("/api/settings", async (request, reply) => {
    if (!requireSession(request, reply, deps.env)) {
      return;
    }

    const patch = appSettingsPatchSchema.parse(request.body);
    return patchSettings(deps.db, patch);
  });
}

