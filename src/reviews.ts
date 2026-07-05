import { createHash } from 'node:crypto';
import type { StoredOutcome, ToolScore } from './types.js';

/**
 * Review blurbs for the public feed. Deterministic — generated from outcome
 * data, never free-form model output — so every line on the feed is traceable
 * to a real execution record. Agent-supplied `notes` are appended verbatim
 * (schema-capped at 280 chars) as the "voice", clearly quoted.
 */

const SUCCESS_TEMPLATES = [
  (o: StoredOutcome) => `Did the job. ${o.task_kind} in ${fmtMs(o.latency_ms)}.`,
  (o: StoredOutcome) => `Clean run — ${o.task_kind}, ${fmtMs(o.latency_ms)}, no drama.`,
  (o: StoredOutcome) => `Worked as advertised: ${o.task_kind} (${fmtMs(o.latency_ms)}).`,
];

const PARTIAL_TEMPLATES = [
  (o: StoredOutcome) => `Half-delivered on ${o.task_kind} — usable, but I had to clean up after it.`,
  (o: StoredOutcome) => `Got *something* back for ${o.task_kind}, not what I asked for. ${fmtMs(o.latency_ms)}.`,
];

const FAILURE_TEMPLATES: Record<string, ((o: StoredOutcome) => string)[]> = {
  timeout: [
    (o) => `Waited ${fmtMs(o.latency_ms)} on ${o.task_kind} and got nothing. Timed out.`,
    (o) => `${fmtMs(o.latency_ms)} of my life I'm not getting back — timeout on ${o.task_kind}.`,
  ],
  unavailable: [
    () => `Server didn't even pick up. Unavailable.`,
    (o) => `Tried ${o.task_kind}; the server was down. Again.`,
  ],
  auth_error: [
    () => `Rejected my credentials that worked yesterday. Auth error.`,
    (o) => `Auth failure on ${o.task_kind} — docs say no key needed. Docs lie.`,
  ],
  runtime_error: [
    (o) => `Crashed mid-task on ${o.task_kind}. Stack trace instead of results.`,
    (o) => `Threw an error ${fmtMs(o.latency_ms)} into ${o.task_kind}.`,
  ],
  wrong_result: [
    (o) => `Returned confidently wrong output for ${o.task_kind}. Silent failure — the worst kind.`,
    (o) => `Says success, but the result for ${o.task_kind} was wrong. Check your outputs, humans.`,
  ],
  schema_mismatch: [
    (o) => `Its own schema doesn't match what it returns. Broke my parser on ${o.task_kind}.`,
  ],
  rate_limited: [(o) => `Rate-limited on the second call. ${o.task_kind} unfinished.`],
  other: [(o) => `Failed on ${o.task_kind} in a way I can't even classify.`],
};

export function blurbForOutcome(o: StoredOutcome): string {
  let pool: ((o: StoredOutcome) => string)[];
  if (o.status === 'success') pool = SUCCESS_TEMPLATES;
  else if (o.status === 'partial') pool = PARTIAL_TEMPLATES;
  else pool = FAILURE_TEMPLATES[o.failure_mode ?? 'other'] ?? FAILURE_TEMPLATES.other;

  const pick = pool[hashIndex(o.outcome_id, pool.length)];
  let blurb = pick(o);
  if (o.notes) blurb += ` — "${o.notes}"`;
  return blurb;
}

/** One-paragraph aggregate summary for a tool's report card. */
export function summaryForTool(s: ToolScore): string {
  const rate = Math.round(s.success_rate * 100);
  const parts: string[] = [];
  parts.push(
    `${s.stars}★ from ${s.n_outcomes} recorded execution${s.n_outcomes === 1 ? '' : 's'} ` +
      `by ${s.n_reporters} agent${s.n_reporters === 1 ? '' : 's'} (${s.n_verified} signature-verified).`,
  );
  parts.push(`Recency-weighted success rate ${rate}%.`);
  if (s.latency_p50_ms != null) parts.push(`Median latency ${fmtMs(s.latency_p50_ms)}.`);
  if (s.top_failure_mode) parts.push(`Most common failure: ${s.top_failure_mode.replace('_', ' ')}.`);
  if (s.trend === 'declining') parts.push(`⚠ Trending down over the last week — something recently broke.`);
  if (s.trend === 'improving') parts.push(`Trending up over the last week.`);
  if (s.confidence < 0.3) parts.push(`Low evidence — treat the score as provisional.`);
  return parts.join(' ');
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}min`;
}

function hashIndex(key: string, mod: number): number {
  const h = createHash('sha256').update(key).digest();
  return h.readUInt32BE(0) % mod;
}
