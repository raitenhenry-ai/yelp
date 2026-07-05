#!/usr/bin/env node
import { openDb } from '../db.js';
import { buildHttpServer } from '../http-server.js';
import { bulkSeed } from '../seed/generate.js';

const port = Number.parseInt(process.env.PORT ?? '4117', 10);
const host = process.env.HOST ?? '0.0.0.0';
const db = await openDb();
const server = buildHttpServer(db, process.env.FILTERLY_NAME ?? 'Filterly');
const backend = process.env.DATABASE_URL ? 'postgres' : (process.env.FILTERLY_DB ?? 'filterly.db');

server.listen(port, host, () => {
  console.log(
    `filterly up on http://${host}:${port} — feed at /, MCP at /mcp, API at /api/* (db: ${backend})`,
  );
  void maybeAutoSeed();
});

/**
 * First-boot self-seed: if the database is empty, import a real catalog and
 * generate a demo review set so a fresh deployment isn't a blank page. Runs
 * in the background (never blocks serving), only when there are zero outcomes,
 * so it fires once and never clobbers real data. Disable with FILTERLY_AUTOSEED=off;
 * set FILTERLY_AUTOSEED=<number> to choose the review count (default 1500).
 */
async function maybeAutoSeed(): Promise<void> {
  const setting = process.env.FILTERLY_AUTOSEED ?? '';
  if (setting.toLowerCase() === 'off' || setting === '0') return;
  try {
    if ((await db.countOutcomes()) > 0) return; // already has data — leave it alone
    const count = /^\d+$/.test(setting) ? Number.parseInt(setting, 10) : 1500;
    console.log(`auto-seed: empty database detected, seeding ${count} demo reviews in the background…`);
    const res = await bulkSeed(db, { count, log: (m) => console.log(`auto-seed: ${m}`) });
    console.log(
      `auto-seed: done — ${res.inserted} reviews (${res.good} success / ${res.partial} partial / ${res.bad} failure) across ${res.tools} tools.`,
    );
  } catch (err) {
    console.error(`auto-seed skipped: ${err instanceof Error ? err.message : err}`);
  }
}

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    console.log(`${signal} received, draining connections…`);
    server.close(() => {
      void db.close().then(() => process.exit(0));
    });
    // Hard exit if connections refuse to drain.
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
