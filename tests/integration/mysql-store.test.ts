import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDB } from 'mysql-memory-server';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { loadDotEnv } from '../../src/server/env';
import { createMysqlStore, createPool } from '../../src/server/store/mysql';
import { runMigrations } from '../../src/server/store/migrate';
import { storeContract } from '../contract/store.contract';

/**
 * The shared store contract, run against a real MySQL.
 * By default a MySQL 8.4 is downloaded once (several minutes) and started just for this file, by mysql-memory-server.
 * Set DATABASE_URL_TEST (mysql://user:password@host:port/anydatabase) to use a server you already have instead,
 * for example the same kind of server as production: the test creates its own temporary database there and drops it at the end.
 */
let pool: Pool;
let server: Awaited<ReturnType<typeof createDB>> | undefined;
let admin: Pool | undefined;
let tempDatabase: string | undefined;
let firstRun: string[];

beforeAll(async () => {
  loadDotEnv();
  const external = process.env.DATABASE_URL_TEST?.trim();
  if (external) {
    admin = createPool(external);
    tempDatabase = `hivegen_test_${process.pid}_${Date.now()}`;
    await admin.query(`CREATE DATABASE \`${tempDatabase}\` CHARACTER SET utf8mb4`);
    const url = new URL(external);
    url.pathname = `/${tempDatabase}`;
    pool = createPool(url.toString());
  } else {
    server = await createDB({ version: '8.4.x', dbName: 'hivegen_test' });
    pool = createPool(`mysql://${server.username}@127.0.0.1:${server.port}/${server.dbName}`);
  }
  firstRun = await runMigrations(pool);
}, 600_000);

afterAll(async () => {
  await pool?.end();
  if (admin && tempDatabase) await admin.query(`DROP DATABASE IF EXISTS \`${tempDatabase}\``);
  await admin?.end();
  await server?.stop();
}, 120_000);

/** Empties every table except the list of applied migrations. */
async function emptyTables(): Promise<void> {
  const [tables] = await pool.query<RowDataPacket[]>('SHOW TABLES');
  const names = tables.map((row) => String(Object.values(row)[0])).filter((name) => name !== 'schema_migrations');
  const connection = await pool.getConnection();
  try {
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const name of names) await connection.query(`TRUNCATE TABLE \`${name}\``);
  } finally {
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    connection.release();
  }
}

beforeEach(emptyTables);

describe('MySQL store', () => {
  storeContract(async () => ({ store: createMysqlStore(pool), done: async () => {} }));

  it('keeps times as UTC, and the slot key equals the start only while the booking is active', async () => {
    const store = createMysqlStore(pool);
    const now = new Date('2026-12-01T10:00:00Z');
    const lead = await store.createLead({ publicId: 'raw-utc-lead', name: 'Ann', email: 'ann@example.com', buyerType: 'agent', volume: '1–5', pageVersion: 'main', attribution: {} }, now);
    const made = await store.insertBooking({ leadId: lead.id, start: '2026-12-02T14:00:00.000Z', end: '2026-12-02T14:15:00.000Z', visitorTz: 'America/New_York', status: 'requested', manageToken: 'raw-utc-token' }, now);
    // The text the database holds, not what the driver turns it into.
    const raw = async () => (await pool.query<RowDataPacket[]>(
      'SELECT CAST(start_utc AS CHAR) AS start_text, CAST(created_at AS CHAR) AS created_text, slot_key, active_lead_id FROM bookings WHERE id = ?', [made.id],
    ))[0][0];
    expect(await raw()).toMatchObject({ start_text: '2026-12-02 14:00:00.000', created_text: '2026-12-01 10:00:00.000', slot_key: '2026-12-02 14:00:00.000', active_lead_id: lead.id });
    await store.updateBooking(made.id, { status: 'cancelled' }, now);
    expect(await raw()).toMatchObject({ start_text: '2026-12-02 14:00:00.000', slot_key: null, active_lead_id: null });
  });
});

describe('migrations', () => {
  it('the first run applied the schema, and a second run skips it', async () => {
    expect(firstRun).toEqual(['001_init.sql', '002_inquiries.sql']);
    expect(await runMigrations(pool)).toEqual([]); // already applied in beforeAll
  });

  it('applies new files in name order, once each; a failing file stops the run and is not recorded', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hivegen-migrations-'));
    const write = (name: string, sql: string) => fs.writeFile(path.join(dir, name), sql);
    try {
      await write('002_second.sql', 'INSERT INTO migration_probe (note) VALUES (\'second\');\n');
      await write('001_first.sql', '-- A comment line; with a semicolon.\nCREATE TABLE migration_probe (note VARCHAR(20) NOT NULL);\n\nINSERT INTO migration_probe (note) VALUES (\'first\');\n');
      await write('readme.txt', 'not a migration');
      expect(await runMigrations(pool, dir)).toEqual(['001_first.sql', '002_second.sql']);
      const [rows] = await pool.query<RowDataPacket[]>('SELECT note FROM migration_probe');
      expect(rows.map((r) => r.note)).toEqual(['first', 'second']);
      expect(await runMigrations(pool, dir)).toEqual([]);

      await write('003_broken.sql', 'INSERT INTO migration_probe (note) VALUES (\'third\');\nINSERT INTO no_such_table (x) VALUES (1);\n');
      await write('004_never_reached.sql', 'INSERT INTO migration_probe (note) VALUES (\'fourth\');\n');
      await expect(runMigrations(pool, dir)).rejects.toThrow(/003_broken\.sql/);
      const [applied] = await pool.query<RowDataPacket[]>('SELECT name FROM schema_migrations ORDER BY name');
      expect(applied.map((r) => r.name)).toEqual([...firstRun, '001_first.sql', '002_second.sql'].sort());
    } finally {
      await pool.query('DROP TABLE IF EXISTS migration_probe');
      await pool.query('DELETE FROM schema_migrations WHERE name NOT IN (?)', [firstRun]); // keep what the real migrations recorded
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
