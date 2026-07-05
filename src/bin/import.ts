#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { openDb } from '../db.js';
import { IMPORT_SOURCES } from '../import/sources.js';

/**
 * toolproof-import [source…] [--max N]
 * Sources: mcp-registry, npm (default: all). Creates a directory page for
 * every discovered tool; re-running only fills gaps, never overwrites.
 */
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { max: { type: 'string' } },
});
const max = values.max ? Number.parseInt(values.max, 10) : undefined;
const sources = positionals.length ? positionals : Object.keys(IMPORT_SOURCES);

const db = await openDb();
for (const source of sources) {
  const importer = IMPORT_SOURCES[source];
  if (!importer) {
    console.error(`unknown source "${source}" — available: ${Object.keys(IMPORT_SOURCES).join(', ')}`);
    process.exitCode = 1;
    continue;
  }
  console.log(`importing from ${source}…`);
  try {
    const stats = await importer(db, { max, log: (m) => console.log(m) });
    console.log(
      `${source}: ${stats.seen} seen → ${stats.created} pages created, ${stats.updated} enriched`,
    );
  } catch (err) {
    console.error(`${source} failed: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}
console.log(`directory now has ${await db.countTools()} tool pages.`);
await db.close();
