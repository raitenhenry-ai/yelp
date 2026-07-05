import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb, type FilterlyDb } from '../src/db.js';
import { toPgPlaceholders, sslForConnectionString } from '../src/driver.js';
import { ingestOutcome } from '../src/ingest.js';
import { getDirectory, getLeaderboard, getToolReport, getToolReviews } from '../src/query.js';
import { generateReporterIdentity, signOutcome } from '../src/signing.js';
import { outcome } from './helpers.js';

// Pure-unit checks for the pg dialect helpers — always run.
describe('pg dialect helpers', () => {
  it('translates ? placeholders to $n positionally', () => {
    expect(toPgPlaceholders('SELECT * FROM t WHERE a = ? AND b = ?')).toBe(
      'SELECT * FROM t WHERE a = $1 AND b = $2',
    );
    expect(toPgPlaceholders('no params here')).toBe('no params here');
  });

  it('decides SSL from the connection string', () => {
    expect(sslForConnectionString('postgres://u:p@localhost:5432/db')).toBe(false);
    expect(sslForConnectionString('postgres://u:p@127.0.0.1/db?sslmode=disable')).toBe(false);
    expect(sslForConnectionString('postgres://u:p@ep-x.neon.tech/db?sslmode=require')).toMatchObject({
      rejectUnauthorized: false,
    });
    expect(sslForConnectionString('postgres://u:p@some.host.cloud/db')).toMatchObject({
      rejectUnauthorized: false,
    });
  });
});

// Full backend parity — only when a Postgres URL is provided.
const PG_URL = process.env.TEST_DATABASE_URL;
const maybe = PG_URL ? describe : describe.skip;

maybe('Postgres backend parity', () => {
  let db: FilterlyDb;

  beforeAll(async () => {
    db = await openDb(PG_URL);
    // Clean slate for a deterministic run.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).driver.exec('TRUNCATE outcomes, tools, reporters');
  });

  afterAll(async () => {
    await db?.close();
  });

  it('round-trips a signed outcome and scores it like SQLite', async () => {
    const id = generateReporterIdentity();
    const o = outcome({
      reporter_id: id.reporter_id,
      tool_id: 'mcp:pg/round',
      tool_name: 'PG Round',
      category: 'testing',
      task_kind: 'verify parity',
      quality: 0.9,
    });
    const res = await ingestOutcome(db, signOutcome(o, id));
    expect(res).toMatchObject({ accepted: true, verified: true });

    // dedup
    expect((await ingestOutcome(db, signOutcome(o, id))).accepted).toBe(false);

    const report = await getToolReport(db, 'mcp:pg/round');
    expect(report?.n_outcomes).toBe(1);
    expect(report?.n_verified).toBe(1);
    // A lone fresh reporter is maturity-damped, so a single success lands mid-scale
    // (same as SQLite). The point is it scored a real number above the neutral prior.
    expect(report?.stars).toBeGreaterThan(3);
    expect(report?.success_rate).toBeGreaterThan(0.5);
  });

  it('counts are numbers, not bigint strings', async () => {
    expect(typeof (await db.countOutcomes())).toBe('number');
    const dir = await getDirectory(db, {});
    expect(typeof dir.total).toBe('number');
    for (const e of dir.entries) expect(typeof e.n_outcomes).toBe('number');
  });

  it('case-insensitive search + reviews work (ILIKE / LOWER ordering)', async () => {
    const results = await getToolReviews(db, { capability: 'verify parity' });
    expect(results[0]?.tool_id).toBe('mcp:pg/round');
    const dir = await getDirectory(db, { q: 'PG ROUND' }); // uppercase must still match
    expect(dir.entries.some((e) => e.tool_id === 'mcp:pg/round')).toBe(true);
    const board = await getLeaderboard(db);
    expect(board.some((t) => t.tool_id === 'mcp:pg/round')).toBe(true);
  });
});
