#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { openDb } from '../db.js';
import { bulkSeed } from '../seed/generate.js';

/**
 * filterly-bulkseed [--count N] [--tools M] [--no-import]
 *
 * Generates a realistic mix of good and bad reviews spread across REAL tools
 * from the catalog (real names → looks legit), then bulk-loads them.
 */
const { values } = parseArgs({
  options: {
    count: { type: 'string' },
    tools: { type: 'string' },
    'no-import': { type: 'boolean' },
  },
});

const db = await openDb();
const backend = process.env.DATABASE_URL
  ? process.env.FILTERLY_NEON_HTTP === '1'
    ? 'neon-http'
    : 'postgres'
  : (process.env.FILTERLY_DB ?? 'filterly.db');
console.log(`bulkseed → ${backend}`);

const res = await bulkSeed(db, {
  count: values.count ? Number.parseInt(values.count, 10) : undefined,
  tools: values.tools ? Number.parseInt(values.tools, 10) : undefined,
  doImport: !values['no-import'],
  log: (m) => console.log(m),
});

console.log(
  `done: inserted ${res.inserted} reviews (${res.good} success / ${res.partial} partial / ${res.bad} failure) ` +
    `across ${res.tools} tools. Total outcomes now ${await db.countOutcomes()}, catalog ${await db.countTools()} tools.`,
);
await db.close();
