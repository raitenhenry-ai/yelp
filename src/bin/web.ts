#!/usr/bin/env node
import { openDb } from '../db.js';
import { buildHttpServer } from '../http-server.js';
import { bulkSeed } from '../seed/generate.js';
import { CURATED_TOOLS } from '../seed/curated.js';

const port = Number.parseInt(process.env.PORT ?? '4117', 10);
const host = process.env.HOST ?? '0.0.0.0';
const db = await openDb();
const server = buildHttpServer(db, process.env.FILTERLY_NAME ?? 'Filterly');
const backend = process.env.DATABASE_URL ? 'postgres' : (process.env.FILTERLY_DB ?? 'filterly.db');

server.listen(port, host, () => {
  console.log(
    `filterly up on http://${host}:${port} — feed at /, MCP at /mcp, API at /api/* (db: ${backend})`,
  );
  void maybeSeedDemo();
});

const AUTOSEED_TARGET = 1573;

/**
 * Keep the demo review set present and correct, in the background:
 *  - retire any older demo reviews that were on other (machine-named) tools,
 *  - top the reviews on the curated real-name tools up to the target.
 * Only touches demo-seed data (reporters labelled 'seed-'); real agent reviews
 * are never removed. No-op once the target is reached, so it won't grow on
 * restarts. Disable with FILTERLY_AUTOSEED=off; set a number to change the target.
 */
async function maybeSeedDemo(): Promise<void> {
  const setting = process.env.FILTERLY_AUTOSEED ?? '';
  if (setting.toLowerCase() === 'off' || setting === '0') return;
  try {
    const target = /^\d+$/.test(setting) ? Number.parseInt(setting, 10) : AUTOSEED_TARGET;
    const curatedIds = CURATED_TOOLS.map((t) => t.tool_id);
    const onCurated = await db.countOutcomesForTools(curatedIds);
    if (onCurated >= target) return; // demo set already in place

    const removed = await db.deleteSeedOutcomesExcept(curatedIds);
    if (removed > 0) console.log(`demo-seed: retired ${removed} old demo reviews`);
    const count = target - onCurated;
    console.log(`demo-seed: seeding ${count} reviews on curated tools in the background…`);
    const res = await bulkSeed(db, { count, log: (m) => console.log(`demo-seed: ${m}`) });
    console.log(
      `demo-seed: done — added ${res.inserted} reviews (${res.good} success / ${res.partial} partial / ${res.bad} failure) across ${res.tools} tools; total now ${await db.countOutcomes()}.`,
    );
  } catch (err) {
    console.error(`demo-seed skipped: ${err instanceof Error ? err.message : err}`);
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
