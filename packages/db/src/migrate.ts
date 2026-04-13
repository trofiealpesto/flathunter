import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

async function loadRootEnvFile() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const rootEnvPath = path.resolve(currentDir, "../../../.env");

  try {
    const envFile = await fs.readFile(rootEnvPath, "utf8");

    for (const rawLine of envFile.split(/\r?\n/)) {
      const line = rawLine.trim();

      if (!line || line.startsWith("#")) {
        continue;
      }

      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const existingValue = process.env[key];

      if (existingValue) {
        continue;
      }

      let value = line.slice(separatorIndex + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

async function ensureMigrationsTable(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _flathunter_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function readMigrationFiles(dir: string) {
  const files = await fs.readdir(dir);
  return files.filter((file) => file.endsWith(".sql")).sort();
}

async function main() {
  await loadRootEnvFile();
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({
    connectionString
  });

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(currentDir, "../drizzle/migrations");

  try {
    await ensureMigrationsTable(pool);
    const files = await readMigrationFiles(migrationsDir);

    for (const file of files) {
      const existing = await pool.query("SELECT 1 FROM _flathunter_migrations WHERE filename = $1 LIMIT 1", [file]);

      if (existing.rowCount && existing.rowCount > 0) {
        continue;
      }

      const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
      try {
        await pool.query("BEGIN");
        await pool.query(sql);
        await pool.query("INSERT INTO _flathunter_migrations (filename) VALUES ($1)", [file]);
        await pool.query("COMMIT");
      } catch (error) {
        await pool.query("ROLLBACK");
        throw error;
      }
      // eslint-disable-next-line no-console
      console.log(`Applied migration ${file}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
