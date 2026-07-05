#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ToolProofDb } from '../db.js';
import { probeTarget, type ProbeTarget } from '../probe/runner.js';
import { generateReporterIdentity, type ReporterIdentity } from '../signing.js';

/**
 * Usage: toolproof-probe [targets.json]
 * Spawns each target MCP server, runs its checks, and ingests signed outcomes
 * into the local DB. The probe identity persists in .toolproof/probe-key.json
 * so the fleet has a stable reporter_id across runs.
 */
const targetsPath = resolve(process.argv[2] ?? 'probes/targets.json');
const keyPath = process.env.TOOLPROOF_PROBE_KEY ?? '.toolproof/probe-key.json';

function loadOrCreateIdentity(): ReporterIdentity {
  if (existsSync(keyPath)) {
    return JSON.parse(readFileSync(keyPath, 'utf8')) as ReporterIdentity;
  }
  const identity = generateReporterIdentity();
  mkdirSync(dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, JSON.stringify(identity, null, 2), { mode: 0o600 });
  console.log(`created probe identity ${identity.reporter_id} at ${keyPath}`);
  return identity;
}

const { targets } = JSON.parse(readFileSync(targetsPath, 'utf8')) as { targets: ProbeTarget[] };
const identity = loadOrCreateIdentity();
const db = new ToolProofDb();
db.ensureReporter(identity.reporter_id, {
  public_key: identity.public_key,
  label: process.env.TOOLPROOF_PROBE_LABEL ?? 'toolproof probe fleet',
  kind: 'probe',
});

console.log(`probing ${targets.length} targets from ${targetsPath} as ${identity.reporter_id.slice(0, 12)}…`);
let ok = 0;
let bad = 0;
for (const target of targets) {
  console.log(`▶ ${target.name} (${target.tool_id})`);
  const { outcomes } = await probeTarget(target, identity, db, (m) => console.log(m));
  for (const o of outcomes) o.status === 'success' ? ok++ : bad++;
}
console.log(`done: ${ok} successes, ${bad} failures recorded (all signed + verified).`);
db.close();
