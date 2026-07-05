import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { ToolProofDb } from '../src/db.js';
import { buildHttpServer } from '../src/http-server.js';
import { generateReporterIdentity, signOutcome } from '../src/signing.js';
import { outcome } from './helpers.js';

let server: Server;
let base: string;
const db = new ToolProofDb(':memory:');

beforeAll(async () => {
  server = buildHttpServer(db, 'ToolProof Test');
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(() => {
  server.close();
  db.close();
});

describe('HTTP API', () => {
  it('serves the landing page at / with the live observatory', async () => {
    const res = await fetch(base + '/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('ToolProof Test');
    expect(html).toContain('signed receipt');
    expect(html).toContain('id="obs-feed"'); // observatory polls the real API
    expect(html).toContain('/api/feed');
  });

  it('serves the full feed page at /feed', async () => {
    const res = await fetch(base + '/feed');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('ToolProof Test');
    expect(html).toContain('signed execution');
  });

  it('accepts a signed outcome via POST /api/outcomes and serves it back', async () => {
    const identity = generateReporterIdentity();
    const o = outcome({ reporter_id: identity.reporter_id });
    const res = await fetch(base + '/api/outcomes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(signOutcome(o, identity)),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { accepted: boolean; verified: boolean };
    expect(body).toMatchObject({ accepted: true, verified: true });

    const feed = (await (await fetch(base + '/api/feed')).json()) as { feed: unknown[] };
    expect(feed.feed.length).toBe(1);

    const tools = (await (
      await fetch(base + '/api/tools?capability=test%20thing')
    ).json()) as { results: { tool_id: string }[] };
    expect(tools.results[0]?.tool_id).toBe('mcp:test/tool');

    const report = await fetch(base + '/api/tools/' + encodeURIComponent('mcp:test/tool'));
    expect(report.status).toBe(200);
  });

  it('rejects tampered submissions with 422', async () => {
    const identity = generateReporterIdentity();
    const o = outcome({ reporter_id: identity.reporter_id });
    const signed = signOutcome(o, identity);
    signed.outcome = { ...signed.outcome, latency_ms: 1 };
    const res = await fetch(base + '/api/outcomes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(signed),
    });
    expect(res.status).toBe(422);
  });

  it('404s unknown tools and routes', async () => {
    expect((await fetch(base + '/api/tools/nope')).status).toBe(404);
    expect((await fetch(base + '/api/nonexistent')).status).toBe(404);
  });

  it('serves stats', async () => {
    const stats = (await (await fetch(base + '/api/stats')).json()) as {
      outcomes: number;
      verified_share: number;
    };
    expect(stats.outcomes).toBeGreaterThan(0);
    expect(stats.verified_share).toBeGreaterThan(0);
  });
});
