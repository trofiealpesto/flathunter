import { connectDb } from "@flathunter/db";

import { buildApp } from "./app";
import { readApiEnv } from "./config";
import { runPortalAuthRefresh, sourceAuthBootstrapManager } from "./lib/source-auth";

async function main() {
  const env = readApiEnv();
  const { db, pool } = connectDb(env.DATABASE_URL);
  const app = await buildApp({
    db,
    env,
    fetchImpl: fetch,
    sourceAuthRunner: runPortalAuthRefresh,
    sourceAuthBootstrap: sourceAuthBootstrapManager
  });

  app.addHook("onClose", async () => {
    await pool.end();
  });

  await app.listen({
    port: env.PORT,
    host: "0.0.0.0"
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
