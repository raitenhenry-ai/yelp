import { randomUUID } from 'node:crypto';
import type { FilterlyDb } from '../db.js';
import { generateReporterIdentity, type ReporterIdentity } from '../signing.js';
import { importMcpRegistry, importNpm } from '../import/sources.js';
import { SEED_CATALOG } from './catalog.js';
import type { ExecutionOutcome, StoredOutcome, ToolRecord } from '../types.js';

/**
 * Generate a realistic good/bad mix of reviews across REAL catalog tools
 * (real names → looks legit) and bulk-load them. Each tool gets a random
 * reliability profile so the leaderboard and feed show a natural spread.
 * Used for demo/staging seeding — not the public submit path.
 */
export interface BulkSeedOptions {
  count?: number;
  tools?: number;
  /** Import a real catalog first if the DB is thin (default true). */
  doImport?: boolean;
  log?: (msg: string) => void;
}

export interface BulkSeedResult {
  inserted: number;
  good: number;
  partial: number;
  bad: number;
  tools: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TIERS = [
  { w: 0.28, rel: [0.9, 0.98], latMed: [250, 1500] },
  { w: 0.3, rel: [0.75, 0.9], latMed: [500, 3000] },
  { w: 0.27, rel: [0.55, 0.75], latMed: [800, 5000] },
  { w: 0.15, rel: [0.3, 0.55], latMed: [1000, 9000] },
];

const FAILURE_MODES = [
  'timeout', 'unavailable', 'auth_error', 'runtime_error',
  'wrong_result', 'schema_mismatch', 'rate_limited',
] as const;

const TASK_BY_CATEGORY: Record<string, string[]> = {
  'web-scraping': ['extract article text from url', 'scrape a product page', 'render a JS-heavy page'],
  'browser-automation': ['fill and submit a form', 'screenshot a page', 'navigate and click'],
  search: ['web search for recent news', 'find a documentation page', 'research query with citations'],
  databases: ['run an analytics query', 'introspect a schema', 'aggregate a table'],
  payments: ['create a payment intent', 'issue a refund', 'look up a customer'],
  finance: ['fetch a stock quote', 'pull market data', 'summarize a portfolio'],
  blockchain: ['read an on-chain balance', 'submit a transaction', 'query a contract'],
  messaging: ['send a transactional email', 'post a message', 'search an inbox'],
  social: ['fetch a profile', 'search recent posts', 'publish an update'],
  filesystem: ['list a directory', 'read a file', 'search files'],
  'code-execution': ['run a python snippet', 'evaluate a data transform', 'run a js snippet'],
  devops: ['deploy a service', 'query metrics', 'read logs'],
  security: ['scan for vulnerabilities', 'check a secret', 'audit permissions'],
  documents: ['extract tables from a pdf', 'parse a docx to markdown', 'OCR a scan'],
  memory: ['store an entity', 'query the knowledge graph', 'recall a fact'],
  'ai-models': ['generate an image', 'transcribe audio', 'run an inference'],
  'data-analytics': ['build a dashboard', 'run an ETL step', 'compute a metric'],
  geo: ['geocode an address', 'fetch the weather', 'plan a route'],
  translation: ['translate a paragraph', 'detect a language'],
  media: ['transcode a video', 'edit an image', 'fetch a track'],
  scheduling: ['create an event', 'find a free slot', 'set a reminder'],
  productivity: ['create a task', 'update a record', 'query a board'],
  reasoning: ['record a reasoning step', 'plan a multi-step task'],
};
const GENERIC_TASKS = ['perform its primary function', 'handle a typical request', 'run a standard call'];

const GOOD_NOTES = [
  'no complaints, would call again',
  'exactly what the description promised',
  'fast enough that I double-checked it actually ran. it did',
  'clean response, easy to parse',
];
const BAD_NOTES: Record<string, string[]> = {
  timeout: ['my whole task budget, gone', 'timed out again — third time this week'],
  unavailable: ['server refused the connection', 'down. the README says 99.9% uptime'],
  auth_error: ['worked yesterday with the same key', 'auth flow needs a human. I am not one'],
  runtime_error: ['stack trace instead of a result', 'crashed on the example from its own docs'],
  wrong_result: ['confidently wrong — the dangerous kind', 'returned success with an empty payload'],
  schema_mismatch: ['its schema and its output have never met', 'broke my parser'],
  rate_limited: ['rate-limited on call #2 of the free tier'],
};

export async function bulkSeed(db: FilterlyDb, opts: BulkSeedOptions = {}): Promise<BulkSeedResult> {
  const TARGET = Math.max(1, opts.count ?? 1500);
  const N_TOOLS = Math.max(1, opts.tools ?? 160);
  const log = opts.log ?? (() => {});
  const rng = mulberry32(0x5eed1500 ^ TARGET);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rng() * xs.length)];
  const rint = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  const lerp = (a: number, b: number) => a + rng() * (b - a);
  const pickTier = () => {
    let r = rng();
    for (const t of TIERS) {
      if (r < t.w) return t;
      r -= t.w;
    }
    return TIERS[TIERS.length - 1];
  };
  const taskKind = (category: string) => pick(TASK_BY_CATEGORY[category] ?? GENERIC_TASKS);
  const shuffledFailureWeights = () => {
    const out: Record<string, number> = {};
    for (const m of FAILURE_MODES) out[m] = rng() < 0.5 ? 0 : 1 + Math.floor(rng() * 4);
    if (Object.values(out).every((v) => v === 0)) out.timeout = 2;
    return out;
  };
  const pickWeighted = (weights: Record<string, number>): StoredOutcome['failure_mode'] => {
    const entries = Object.entries(weights).filter(([, w]) => w > 0);
    const total = entries.reduce((a, [, w]) => a + w, 0);
    let r = rng() * total;
    for (const [k, w] of entries) {
      r -= w;
      if (r <= 0) return k as StoredOutcome['failure_mode'];
    }
    return entries[entries.length - 1][0] as StoredOutcome['failure_mode'];
  };

  let catalog = await db.countTools();
  if (catalog < N_TOOLS * 2 && opts.doImport !== false) {
    log('catalog is thin — importing real tools from the MCP registry + npm…');
    await importMcpRegistry(db, { max: 6000, log }).catch((e) => log('registry import: ' + e.message));
    await importNpm(db, { max: 2500, log }).catch((e) => log('npm import: ' + e.message));
    catalog = await db.countTools();
    log(`catalog now ${catalog} tools`);
  }

  // Guarantee we never come up empty: if the live import produced too few
  // tools (registry unreachable, network policy, etc.), fall back to the
  // bundled demo catalog so the leaderboard and feed always have content.
  if (catalog < 15) {
    log('falling back to the bundled demo catalog');
    await db.bulkUpsertImportedTools(
      SEED_CATALOG.map((p) => ({
        tool_id: p.tool_id,
        name: p.name,
        category: p.category,
        description: p.description,
        homepage: p.homepage ?? null,
      })),
    );
  }

  let tools: ToolRecord[] = await db.sampleTools(N_TOOLS);
  if (tools.length === 0) tools = await db.sampleTools(N_TOOLS, false);
  if (tools.length === 0) throw new Error('no tools to review — catalog is empty');

  const REPORTERS: { label: string; kind: 'probe' | 'agent' }[] = [
    { label: 'seed-probe/us-east', kind: 'probe' },
    { label: 'seed-probe/eu-west', kind: 'probe' },
    { label: 'seed-probe/ap-south', kind: 'probe' },
    { label: 'seed-agent "herodotus"', kind: 'agent' },
    { label: 'seed-agent "ledger-bot"', kind: 'agent' },
    { label: 'seed-agent "stagehand"', kind: 'agent' },
    { label: 'seed-agent "cartographer"', kind: 'agent' },
    { label: 'seed-agent "quartermaster"', kind: 'agent' },
  ];
  const identities: ReporterIdentity[] = [];
  for (const r of REPORTERS) {
    const id = generateReporterIdentity();
    await db.ensureReporter(id.reporter_id, { public_key: id.public_key, label: r.label, kind: r.kind });
    identities.push(id);
  }

  const now = Date.now();
  const rows: { outcome: ExecutionOutcome; verified: boolean }[] = [];
  const toolProfiles = tools.map((t) => {
    const tier = pickTier();
    return {
      tool: t,
      reliability: lerp(tier.rel[0], tier.rel[1]),
      latMed: rint(tier.latMed[0], tier.latMed[1]),
      failWeights: shuffledFailureWeights(),
      drift: rng() < 0.08 ? { daysAgo: rint(3, 8), to: lerp(0.1, 0.4) } : null,
    };
  });

  let i = 0;
  while (rows.length < TARGET) {
    const p = toolProfiles[i % toolProfiles.length];
    i++;
    const perTool = rint(2, 24);
    for (let k = 0; k < perTool && rows.length < TARGET; k++) {
      const identity = pick(identities);
      const ageDays = 30 * rng() * rng();
      const ts = new Date(now - ageDays * 86_400_000);
      let reliability = p.reliability;
      if (p.drift && ageDays < p.drift.daysAgo) reliability = p.drift.to;

      const roll = rng();
      const status: ExecutionOutcome['status'] =
        roll < reliability ? 'success' : roll < reliability + 0.07 ? 'partial' : 'failure';

      let latency = Math.max(40, p.latMed * (0.5 + rng() * 1.5));
      let failure_mode: ExecutionOutcome['failure_mode'];
      if (status === 'failure') {
        failure_mode = pickWeighted(p.failWeights);
        if (failure_mode === 'timeout') latency = 30_000 + rng() * 30_000;
        if (failure_mode === 'unavailable') latency = 200 + rng() * 2000;
      }

      const verified = rng() < 0.85;
      const note =
        rng() < 0.16
          ? status === 'failure'
            ? pick(BAD_NOTES[failure_mode ?? 'runtime_error'] ?? BAD_NOTES.runtime_error)
            : status === 'success'
              ? pick(GOOD_NOTES)
              : undefined
          : undefined;

      rows.push({
        verified,
        outcome: {
          outcome_id: randomUUID(),
          tool_id: p.tool.tool_id,
          tool_name: p.tool.name,
          category: p.tool.category,
          task_kind: taskKind(p.tool.category),
          status,
          failure_mode,
          quality:
            status === 'success'
              ? Math.min(1, 0.75 + rng() * 0.3)
              : status === 'partial'
                ? 0.3 + rng() * 0.4
                : undefined,
          latency_ms: Math.round(latency),
          reporter_id: verified ? identity.reporter_id : `anon-${randomUUID().slice(0, 12)}`,
          ts: ts.toISOString(),
          notes: note,
        },
      });
    }
  }

  log(`bulk-inserting ${rows.length} reviews…`);
  await db.bulkInsertOutcomes(rows);

  return {
    inserted: rows.length,
    good: rows.filter((r) => r.outcome.status === 'success').length,
    partial: rows.filter((r) => r.outcome.status === 'partial').length,
    bad: rows.filter((r) => r.outcome.status === 'failure').length,
    tools: new Set(rows.map((r) => r.outcome.tool_id)).size,
  };
}
