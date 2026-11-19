import fs from 'node:fs/promises';
import path from 'node:path';
import type { Pool, RowDataPacket } from 'mysql2/promise';

/** Only one process migrates at a time (the host may start several); the others wait here, then find nothing left to do. */
const LOCK_NAME = 'hivegen_migrations';
const LOCK_WAIT_SECONDS = 60;

/**
 * The statements of a migration file: full-line `--` comments are dropped, the rest is split at semicolons.
 * Migration files therefore keep a semicolon only where a statement ends, and comments on lines of their own.
 */
function statementsOf(sql: string): string[] {
  const code = sql.split(/\r?\n/).filter((line) => !line.trimStart().startsWith('--')).join('\n');
  return code.split(';').map((statement) => statement.trim()).filter(Boolean);
}

/**
 * Applies the `.sql` files in `dir` that are not yet listed in `schema_migrations`, in name order, and returns the names applied.
 * MySQL cannot undo a half-run schema change, so write each file to be safe to run again (`CREATE TABLE IF NOT EXISTS`):
 * a file that fails is not recorded, the run stops there, and the next run starts with that file again.
 */
export async function runMigrations(pool: Pool, dir = 'db/migrations'): Promise<string[]> {
  const files = (await fs.readdir(dir)).filter((name) => name.endsWith('.sql')).sort();
  const connection = await pool.getConnection(); // the lock belongs to this connection
  try {
    const [[lock]] = await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?, ?) AS got', [LOCK_NAME, LOCK_WAIT_SECONDS]);
    if (lock.got !== 1) throw new Error('migrations: another process is migrating and did not finish in time');
    try {
      await connection.query(
        'CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(190) NOT NULL, applied_at DATETIME(3) NOT NULL, PRIMARY KEY (name)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
      );
      const [done] = await connection.query<RowDataPacket[]>('SELECT name FROM schema_migrations');
      const applied = new Set(done.map((row) => String(row.name)));

      const ran: string[] = [];
      for (const file of files) {
        if (applied.has(file)) continue;
        try {
          for (const statement of statementsOf(await fs.readFile(path.join(dir, file), 'utf8'))) await connection.query(statement);
          await connection.query('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', [file, new Date()]);
        } catch (error) {
          throw new Error(`migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
        }
        ran.push(file);
      }
      return ran;
    } finally {
      await connection.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]);
    }
  } finally {
    connection.release();
  }
}
