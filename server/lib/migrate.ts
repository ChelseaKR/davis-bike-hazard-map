/**
 * Tiny, dependency-free SQL migration runner.
 *
 * Versioned `.sql` files in /migrations are applied in lexical order, each in a
 * transaction, and recorded in `schema_migrations` so they run exactly once.
 * No migration framework — same minimalism as the hand-rolled token/scrypt code.
 * Forward-only by design (a civic MVP doesn't need down-migrations); add a new
 * numbered file to evolve the schema.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';

// The server always runs from the repo root (npm scripts) / WORKDIR /app
// (Docker), with migrations/ at that root.
const MIGRATIONS_DIR = join(process.cwd(), 'migrations');

/** Apply any pending migrations. Returns the versions newly applied. */
export async function runMigrations(pool: Pool): Promise<string[]> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version TEXT PRIMARY KEY,
       applied_at BIGINT NOT NULL
     )`,
  );

  const applied = new Set(
    (await pool.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map(
      (r) => r.version,
    ),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const ran: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)', [
        version,
        Date.now(),
      ]);
      await client.query('COMMIT');
      ran.push(version);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  return ran;
}
