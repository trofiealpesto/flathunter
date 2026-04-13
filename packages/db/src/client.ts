import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

export function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString
  });
}

export function createDb(pool: Pool): Database {
  return drizzle(pool, { schema });
}

export function connectDb(connectionString: string): { db: Database; pool: Pool } {
  const pool = createPool(connectionString);

  return {
    db: createDb(pool),
    pool
  };
}

