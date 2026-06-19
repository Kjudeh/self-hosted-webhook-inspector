import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

// Railway-managed Postgres requires TLS but uses self-signed certs, so we
// disable cert verification only when the URL clearly points at a remote host.
const needsSsl = /\b(railway|render|amazonaws|supabase|neon)\b/i.test(
  config.databaseUrl,
);

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as never[]);
}

/** Wait for the DB to accept connections, retrying on cold start. */
export async function waitForDb(
  retries = 10,
  delayMs = 2000,
): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn(
        `DB not ready (attempt ${attempt}/${retries}): ${msg}`,
      );
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

/** Run the idempotent migration on boot. */
export async function migrate(): Promise<void> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  // dist/server/db.js → project root → migrations/
  const sqlPath = resolve(__dirname, "../../migrations/001_init.sql");
  const sql = await readFile(sqlPath, "utf8");
  await pool.query(sql);
  // eslint-disable-next-line no-console
  console.log("Migration applied.");
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
