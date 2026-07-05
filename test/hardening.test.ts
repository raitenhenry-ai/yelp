import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { ToolProofDb } from '../src/db.js';
import { buildHttpServer } from '../src/http-server.js';
import { scoreTool, DEFAULT_SCORING, UNVERIFIED_REPORTER_BUCKET } from '../src/scoring.js';
import { safeHref } from '../src/web/shared.js';
import { ingestOutcome } from '../src/ingest.js';
import { generateReporterIdentity, signOutcome } from '../src/signing.js';
import type { StoredOutcome, ToolRecord } from '../src/types.js';
import { daysAgo, memDb, outcome } from './helpers.js';

const tool: ToolRecord = {
  tool_id: 'mcp:t/x',
  name: 'X',
  category: 'testing',
  description: '',
  homepage: null,
  first_seen: daysAgo(60),
};
function stored(o: Partial<StoredOutcome> = {}): StoredOutcome {
  return { ...outcome(), verified: true, received_at: new Date().toISOString(), ...o };
}

// ---- F9: share cap converges to the exact bound even at extreme imbalance ----
describe('share-cap direct fixed point (F9)', () => {
  it('holds the intended cap regardless of flooder volume', () => {
    // 3 reporters: A floods N verified successes; B one success; C one failure.
    // Intended fixed point: A capped to 2/3 share ⇒ score 0.750 for ALL N.
    for (const N of [10, 1_000, 30_000, 200_000]) {
      const outcomes: StoredOutcome[] = [
        ...Array.from({ length: N }, () => stored({ ts: daysAgo(1), reporter_id: 'A' })),
        stored({ ts: daysAgo(1), reporter_id: 'B' }),
        stored({ status: 'failure', failure_mode: 'timeout', ts: daysAgo(1), reporter_id: 'C' }),
      ];
      const s = scoreTool(tool, outcomes);
      expect(Math.abs(s.score - 0.75)).toBeLessThan(0.01);
    }
  });

  it('a 60x single-reporter flood cannot pass the crowd of failures', () => {
    const outcomes = [
      ...Array.from({ length: 6 }, (_, i) =>
        stored({ status: 'failure', failure_mode: 'wrong_result', ts: daysAgo(1), reporter_id: `c${i}` }),
      ),
      ...Array.from({ length: 60 }, () => stored({ ts: daysAgo(1), reporter_id: 'shill' })),
    ];
    expect(scoreTool(tool, outcomes).score).toBeLessThan(0.5);
  });
});

// ---- H2: all unverified outcomes collapse into one share-cap bucket ----
describe('unverified reporter bucket (H2)', () => {
  it('unsigned reviews across many fake ids cannot evade the cap', () => {
    // 100 unsigned 5-star across 100 distinct fake reporter_ids + 3 verified failures.
    const outcomes = [
      ...Array.from({ length: 100 }, (_, i) =>
        stored({ verified: false, ts: daysAgo(1), reporter_id: `fake-${i}` }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        stored({ status: 'failure', failure_mode: 'timeout', ts: daysAgo(1), reporter_id: `real-${i}` }),
      ),
    ];
    // With the bucket collapse there are effectively 2 reporters (one unverified
    // bucket + real failures merged is >2 distinct real ids)... the key property:
    // the 100 unsigned cannot dominate. Score stays well below a 4-star (0.75).
    const s = scoreTool(tool, outcomes);
    expect(s.score).toBeLessThan(0.7);
  });

  it('exposes the bucket constant', () => {
    expect(UNVERIFIED_REPORTER_BUCKET).toBe('__unverified__');
  });
});

// ---- H3: reporter maturity dampens fresh Sybil swarms ----
describe('reporter maturity (H3)', () => {
  it('a swarm of brand-new keys scores lower than the same reviews from mature reporters', () => {
    const successes = Array.from({ length: 30 }, (_, i) =>
      stored({ ts: daysAgo(1), reporter_id: `k${i}` }),
    );
    const failures = Array.from({ length: 5 }, (_, i) =>
      stored({ status: 'failure', failure_mode: 'timeout', ts: daysAgo(1), reporter_id: `f${i}` }),
    );
    const all = [...successes, ...failures];

    // No reputation info ⇒ everyone fully mature (backward-compatible baseline).
    const baseline = scoreTool(tool, all);

    // Fresh swarm: every reporter has ~1 verified outcome globally ⇒ heavy damping.
    const freshRep = new Map<string, number>();
    for (const o of all) freshRep.set(o.reporter_id, 1);
    const damped = scoreTool(tool, all, { reputation: freshRep });

    // Mature swarm: every reporter has a long history ⇒ ~no damping ≈ baseline.
    const matureRep = new Map<string, number>();
    for (const o of all) matureRep.set(o.reporter_id, 500);
    const mature = scoreTool(tool, all, { reputation: matureRep });

    expect(damped.score).toBeLessThan(baseline.score);
    expect(Math.abs(mature.score - baseline.score)).toBeLessThan(0.05);
  });

  it('omitting reputation leaves scores identical (pure-function stability)', () => {
    const outcomes = Array.from({ length: 8 }, (_, i) =>
      stored({ ts: daysAgo(i % 4), reporter_id: `r${i % 3}` }),
    );
    const a = scoreTool(tool, outcomes);
    const b = scoreTool(tool, outcomes, { reputation: undefined });
    expect(a.score).toBe(b.score);
    expect(DEFAULT_SCORING.maturityFloor).toBe(0.3);
  });
});

// ---- H5: future-dated timestamps are clamped at ingest ----
describe('future-ts clamp (H5)', () => {
  it('clamps a far-future ts to ~now so it decays normally', () => {
    const db = memDb();
    const future = new Date(Date.now() + 10 * 365 * 86_400_000).toISOString();
    ingestOutcome(db, { outcome: outcome({ tool_id: 'mcp:f/t', ts: future }) });
    const stored = db.outcomesForTool('mcp:f/t')[0];
    expect(new Date(stored.ts).getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  it('leaves a normal recent ts untouched', () => {
    const db = memDb();
    const ts = daysAgo(2);
    ingestOutcome(db, { outcome: outcome({ tool_id: 'mcp:n/t', ts }) });
    expect(db.outcomesForTool('mcp:n/t')[0].ts).toBe(ts);
  });
});

// ---- H1: safeHref blocks dangerous URL schemes ----
describe('safeHref (H1)', () => {
  it('allows http/https and rejects dangerous schemes', () => {
    expect(safeHref('https://example.com/x')).toBe('https://example.com/x');
    expect(safeHref('http://example.com')).toBe('http://example.com/');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('JavaScript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeHref('vbscript:msgbox(1)')).toBeNull();
    expect(safeHref('  javascript:alert(1)')).toBeNull();
    expect(safeHref('java\nscript:alert(1)')).toBeNull();
    expect(safeHref('')).toBeNull();
    expect(safeHref(null)).toBeNull();
    expect(safeHref('not a url')).toBeNull();
  });
});

// ---- HTTP hardening: F4 (malformed %), F5 (413), F6 (405), MCP-1 ----
describe('HTTP hardening', () => {
  let server: Server;
  let base: string;
  const db = new ToolProofDb(':memory:');

  beforeAll(async () => {
    ingestOutcome(db, { outcome: outcome({ tool_id: 'mcp:hh/t', tool_name: 'HH', category: 'testing' }) });
    server = buildHttpServer(db, 'HH');
    await new Promise<void>((r) => server.listen(0, r));
    const a = server.address();
    base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
  });
  afterAll(() => {
    server.close();
    db.close();
  });

  it('F4: malformed percent-encoding → 400, not 500', async () => {
    for (const p of ['/tool/%', '/tool/%zz', '/api/tools/%ff']) {
      const res = await fetch(base + p);
      expect(res.status).toBe(400);
    }
  });

  it('F5: oversized POST body → 413 with a JSON error (not a reset)', async () => {
    const res = await fetch(base + '/api/outcomes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '"' + 'p'.repeat(70 * 1024) + '"',
    });
    expect(res.status).toBe(413);
    expect((await res.json()) as { error: string }).toHaveProperty('error');
  });

  it('F6: known path, wrong method → 405 + Allow', async () => {
    const res = await fetch(base + '/api/stats', { method: 'PUT' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET');
    const post = await fetch(base + '/api/stats', { method: 'POST' });
    expect(post.status).toBe(405);
  });

  it('MCP-1: GET/DELETE /mcp → 405 + Allow: POST (no idle SSE)', async () => {
    const get = await fetch(base + '/mcp', { method: 'GET' });
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    const del = await fetch(base + '/mcp', { method: 'DELETE' });
    expect(del.status).toBe(405);
  });

  it('valid requests still work after hardening', async () => {
    expect((await fetch(base + '/api/stats')).status).toBe(200);
    expect((await fetch(base + '/tool/' + encodeURIComponent('mcp:hh/t'))).status).toBe(200);
    const signed = signOutcome(
      outcome({ reporter_id: generateReporterIdentity().reporter_id, tool_id: 'mcp:hh/t' }),
      generateReporterIdentity(),
    );
    // (mismatched identity ⇒ rejected, but the point is a well-formed POST returns JSON, not a reset)
    const res = await fetch(base + '/api/outcomes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(signed),
    });
    expect([201, 422]).toContain(res.status);
  });
});
