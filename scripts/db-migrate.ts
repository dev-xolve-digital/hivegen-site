/**
 * Creates or updates the booking tables: `npm run db:migrate`.
 * Reads DATABASE_URL (mysql://user:password@host:port/database) from the environment or from `.env`.
 * Safe to run again: it applies only the migration files that have not been applied yet.
 */
import { loadDotEnv } from '../src/server/env';
import { runMigrations } from '../src/server/store/migrate';
import { createPool } from '../src/server/store/mysql';

loadDotEnv();
const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error('DATABASE_URL is not set. Put it in .env (see .env.example) or in the environment.');
  process.exit(1);
}

const pool = createPool(url);
try {
  const applied = await runMigrations(pool);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Nothing to apply: the database is up to date.');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error)); // the message only: never the connection URL
  process.exitCode = 1;
} finally {
  await pool.end();
}
