#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openDb } from '../db.js';
import { loadOrCreateIdentity } from '../identity.js';
import { probeTarget, type ProbeTarget } from '../probe/runner.js';

/**
 * toolproof-probe [targets.json] [--watch <seconds>]
 *
 * Spawns each target MCP server, runs its checks, and ingests signed outcomes
 * into the local DB. With --watch it loops forever — recency-weighted scoring
 * only means something if the probes keep running, so production deployments
 * should run this as a sidecar (see docker-compose.yml).
 *
 * The probe identity persists (default .toolproof/probe-key.json, override
 * with TOOLPROOF_PROBE_KEY) so the fleet has a stable reporter_id.
 */
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    watch: { type: 'string' },
  },
});

const targetsPath = resolve(positionals[0] ?? 'probes/targets.json');
const watchSeconds = values.watch ? Math.max(30, Number.parseInt(values.watch, 10)) : null;
const keyPath = process.env.TOOLPROOF_PROBE_KEY ?? '.toolproof/probe-key.json';

const identity = loadOrCreateIdentity(keyPath);
const db = await openDb();
await db.ensureReporter(identity.reporter_id, {
  public_key: identity.public_key,
  label: process.env.TOOLPROOF_PROBE_LABEL ?? 'toolproof probe fleet',
  kind: 'probe',
});

async function round(): Promise<void> {
  // Re-read targets each round so edits apply without a restart.
  const { targets } = JSON.parse(readFileSync(targetsPath, 'utf8')) as { targets: ProbeTarget[] };
  console.log(
    `[${new Date().toISOString()}] probing ${targets.length} targets as ${identity.reporter_id.slice(0, 12)}…`,
  );
  let ok = 0;
  let bad = 0;
  for (const target of targets) {
    console.log(`▶ ${target.name} (${target.tool_id})`);
    const { outcomes } = await probeTarget(target, identity, db, (m) => console.log(m));
    for (const o of outcomes) o.status === 'success' ? ok++ : bad++;
  }
  console.log(`round done: ${ok} successes, ${bad} failures recorded (all signed + verified).`);
}

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopping = true;
    console.log(`${signal} received — finishing current round, then exiting.`);
  });
}

await round();
if (watchSeconds) {
  console.log(`watch mode: repeating every ${watchSeconds}s`);
  while (!stopping) {
    await new Promise((r) => setTimeout(r, watchSeconds * 1000));
    if (stopping) break;
    await round();
  }
}
await db.close();
