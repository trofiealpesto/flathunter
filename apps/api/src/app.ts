import cookie from "@fastify/cookie";
import type { Database } from "@flathunter/db";
import Fastify from "fastify";

import type { ApiEnv } from "./config";
import type {
  SourceAuthBootstrapManager,
  SourceAuthRunnerInput,
  SourceAuthRunnerResult
} from "./lib/source-auth";
import { registerAuthRoutes } from "./routes/auth";
import { registerContactRoutes } from "./routes/contacts";
import { registerGeoRoutes } from "./routes/geo";
import { registerListingRoutes } from "./routes/listings";
import { registerSettingsRoutes } from "./routes/settings";
import { registerSourceRoutes } from "./routes/sources";
import { registerStatsRoutes } from "./routes/stats";

export type AppDeps = {
  db: Database;
  env: ApiEnv;
  fetchImpl: typeof fetch;
  sourceAuthRunner: (input: SourceAuthRunnerInput) => Promise<SourceAuthRunnerResult>;
  sourceAuthBootstrap: SourceAuthBootstrapManager;
};

export async function buildApp(deps: AppDeps) {
  const app = Fastify({
    logger:
      deps.env.NODE_ENV === "production"
        ? true
        : {
            level: "warn"
          }
  });

  await app.register(cookie);

  app.get("/health", async () => ({
    ok: true
  }));

  registerAuthRoutes(app, deps);
  registerContactRoutes(app, deps);
  registerGeoRoutes(app, deps);
  registerListingRoutes(app, deps);
  registerSettingsRoutes(app, deps);
  registerSourceRoutes(app, deps);
  registerStatsRoutes(app, deps);

  return app;
}
