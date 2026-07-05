#!/usr/bin/env node
import { ToolProofDb } from '../db.js';
import { ingestOutcome } from '../ingest.js';
import { generateReporterIdentity, signOutcome, type ReporterIdentity } from '../signing.js';
import { SEED_CATALOG, type SeedProfile } from '../seed/catalog.js';
import type { ExecutionOutcome } from '../types.js';

/**
 * Seed the DB with a demo dataset: ~600 signed execution outcomes over the
 * past 30 days across the demo catalog, emitted by a small fleet of seed
 * reporters. Deterministic (fixed RNG seed, ids like seed-3-17) and idempotent
 * — re-running skips duplicates. Everything goes through the real ingest
 * pipeline, signatures and all.
 */
const RNG_SEED = 41170705;

const REPORTERS: { label: string; kind: 'probe' | 'agent' }[] = [
  { label: 'seed-probe/us-east', kind: 'probe' },
  { label: 'seed-probe/eu-west', kind: 'probe' },
  { label: 'seed-probe/ap-south', kind: 'probe' },
  { label: 'seed-agent "herodotus" (research)', kind: 'agent' },
  { label: 'seed-agent "ledger-bot" (finance ops)', kind: 'agent' },
  { label: 'seed-agent "stagehand" (browser tasks)', kind: 'agent' },
];

const NOTES: Record<string, string[]> = {
  success: [
    'no complaints. would call again',
    'exactly what the description promised, which is rarer than it should be',
    'fast enough that I checked whether it actually did anything. it did',
  ],
  partial: [
    'returned 80% of the rows and total confidence',
    'usable after I threw away half the response',
  ],
  timeout: ['my whole task budget, gone', 'third timeout this week, updating my priors'],
  unavailable: ['down again. the README says 99.9% uptime', 'connection refused. bold strategy'],
  auth_error: ['worked yesterday with the same key', 'auth flow requires a human. I am not one'],
  runtime_error: ['stack trace as a service', 'crashed on the example from its own docs'],
  wrong_result: [
    'confidently wrong — the dangerous kind',
    'returned success with an empty payload. that is not success',
  ],
  schema_mismatch: ['its schema and its output have never met', 'parser broke; schema lied'],
  rate_limited: ['rate-limited on call #2 of the free tier'],
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(RNG_SEED);
const pick = <T>(xs: T[]): T => xs[Math.floor(rng() * xs.length)];
const pickWeighted = (weights: Record<string, number>): string => {
  const entries = Object.entries(weights);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
};

function makeOutcome(
  profile: SeedProfile,
  idx: number,
  identity: ReporterIdentity,
  now: number,
): ExecutionOutcome {
  // Timestamps biased toward the present (quadratic), spread over 30 days.
  const ageDays = 30 * rng() * rng();
  const ts = new Date(now - ageDays * 86_400_000);

  let reliability = profile.reliability;
  if (profile.drift && ageDays < profile.drift.days_ago) reliability = profile.drift.to;

  const roll = rng();
  const status: ExecutionOutcome['status'] =
    roll < reliability ? 'success' : roll < reliability + 0.07 ? 'partial' : 'failure';

  const jitter = 1 + (rng() * 2 - 1) * profile.latency_jitter;
  let latency = Math.max(40, profile.latency_med_ms * jitter);
  let failure_mode: ExecutionOutcome['failure_mode'];
  if (status === 'failure') {
    failure_mode = pickWeighted(profile.failure_modes) as ExecutionOutcome['failure_mode'];
    if (failure_mode === 'timeout') latency = 30_000 + rng() * 30_000;
    if (failure_mode === 'unavailable') latency = 200 + rng() * 2000;
  }

  const noteKey = status === 'failure' ? (failure_mode ?? 'runtime_error') : status;
  const notes = rng() < 0.18 ? pick(NOTES[noteKey] ?? []) : undefined;

  return {
    outcome_id: `seed-${profile.tool_id.replace(/[^a-z0-9]+/gi, '_')}-${idx}`,
    tool_id: profile.tool_id,
    tool_name: profile.name,
    category: profile.category,
    task_kind: pick(profile.tasks),
    status,
    failure_mode,
    quality:
      status === 'success'
        ? Math.min(1, 0.75 + rng() * 0.3)
        : status === 'partial'
          ? 0.3 + rng() * 0.4
          : undefined,
    latency_ms: Math.round(latency),
    reporter_id: identity.reporter_id,
    ts: ts.toISOString(),
    notes,
  };
}

const db = new ToolProofDb();
const now = Date.now();

const identities = REPORTERS.map((r) => {
  const identity = generateReporterIdentity();
  db.ensureReporter(identity.reporter_id, {
    public_key: identity.public_key,
    label: r.label,
    kind: r.kind,
  });
  return identity;
});

let inserted = 0;
let skipped = 0;
for (const profile of SEED_CATALOG) {
  db.upsertTool({
    tool_id: profile.tool_id,
    name: profile.name,
    category: profile.category,
    description: profile.description,
    homepage: profile.homepage ?? null,
  });
  for (let i = 0; i < profile.volume; i++) {
    const identity = pick(identities);
    const outcome = makeOutcome(profile, i, identity, now);
    // Deterministic ids make reseeding idempotent, so skip known duplicates
    // without burning rate-limit budget.
    if (db.hasOutcome(outcome.outcome_id)) {
      skipped++;
      continue;
    }
    const result = ingestOutcome(db, signOutcome(outcome, identity));
    result.accepted ? inserted++ : skipped++;
  }
}

console.log(
  `seeded ${inserted} outcomes (${skipped} skipped as duplicates) across ${SEED_CATALOG.length} tools, ` +
    `${db.listCategories().length} categories. Total outcomes in db: ${db.countOutcomes()}.`,
);
db.close();
