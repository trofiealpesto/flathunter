import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

const optionalUrlSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().url().optional()
);

const optionalStringSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional()
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  PORTAL_SECRETS_KEY: z.string().min(16),
  GEMINI_API_KEY: optionalStringSchema,
  GEMINI_API_BASE_URL: z.string().url().default("https://generativelanguage.googleapis.com/v1beta"),
  CAPSOLVER_API_KEY: optionalStringSchema,
  SCRAPER_PROXY_URL: optionalUrlSchema,
  IMMOWELT_SEARCH_URL: z.string().url().default("https://www.immowelt.de/liste/berlin/wohnungen/mieten"),
  WORKER_DEV_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
  IMMOWELT_ENABLE_LIVE_BROWSER: z
    .union([z.literal("true"), z.literal("false")])
    .default("true")
    .transform((value) => value === "true")
});

export type WorkerEnv = z.infer<typeof envSchema> & {
  FIXTURES_DIR: string;
};

function loadRootEnvFile(currentDir: string, input: NodeJS.ProcessEnv) {
  const envPath = path.resolve(currentDir, "../../../.env");

  if (!fs.existsSync(envPath)) {
    return input;
  }

  const merged: NodeJS.ProcessEnv = {
    ...input
  };

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (merged[key] == null || merged[key] === "") {
      merged[key] = value;
    }
  }

  return merged;
}

export function readWorkerEnv(input: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const env = envSchema.parse(loadRootEnvFile(currentDir, input));

  return {
    ...env,
    FIXTURES_DIR: path.resolve(currentDir, "fixtures/immowelt")
  };
}
