import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

const booleanFlagSchema = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .default("true")
  .transform((value) => value === true || value === "true");

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
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  APP_ORIGIN: z.string().url(),
  GEMINI_API_KEY: optionalStringSchema,
  GEMINI_API_BASE_URL: z.string().url().default("https://generativelanguage.googleapis.com/v1beta"),
  NOMINATIM_BASE_URL: z.string().url().default("https://nominatim.openstreetmap.org"),
  SCRAPER_PROXY_URL: optionalUrlSchema,
  PORTAL_SECRETS_KEY: z.string().min(16),
  SESSION_SECRET: z.string().min(16),
  ADMIN_GITHUB_LOGIN: z.string().trim().min(1),
  GITHUB_CLIENT_ID: z.string().trim().min(1),
  GITHUB_CLIENT_SECRET: z.string().trim().min(1),
  ENABLE_MANUAL_SOURCE_AUTH_BOOTSTRAP: booleanFlagSchema
});

export type ApiEnv = z.infer<typeof envSchema>;

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

export function readApiEnv(input: NodeJS.ProcessEnv = process.env): ApiEnv {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return envSchema.parse(loadRootEnvFile(currentDir, input));
}
