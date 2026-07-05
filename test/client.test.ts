import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { ToolProofClient } from '../src/client.js';
import { ToolProofDb } from '../src/db.js';
import { buildHttpServer } from '../src/http-server.js';
import { generateReporterIdentity } from '../src/signing.js';

let server: Server;
let base: string;
const db = new ToolProofDb(':memory:');
const identity = generateReporterIdentity();

beforeAll(async () => {
  server = buildHttpServer(db);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(() => {
  server.close();
  db.close();
});

describe('ToolProofClient', () => {
  it('reports a signed outcome and reads it back through reviews', async () => {
    const tp = new ToolProofClient({ baseUrl: base, identity });
    const res = await tp.reportOutcome({
      tool_id: 'mcp:client/emailer',
      tool_name: 'Client Emailer',
      category: 'messaging',
      task_kind: 'send transactional email',
      status: 'success',
      quality: 1,
      latency_ms: 640,
    });
    expect(res).toMatchObject({ accepted: true, verified: true });

    const reviews = await tp.getToolReviews({ capability: 'send an email' });
    expect(reviews[0].tool_id).toBe('mcp:client/emailer');
    expect(reviews[0].n_verified).toBe(1);

    const report = await tp.getToolReport('mcp:client/emailer');
    expect(report.n_outcomes).toBe(1);
  });

  it('withOutcome times a successful call and reports it without interfering', async () => {
    const tp = new ToolProofClient({ baseUrl: base, identity });
    const before = db.countOutcomes();
    const value = await tp.withOutcome(
      { tool_id: 'mcp:client/adder', category: 'math', task_kind: 'add numbers' },
      async () => {
        await new Promise((r) => setTimeout(r, 25));
        return 42;
      },
    );
    expect(value).toBe(42);
    await waitFor(() => db.countOutcomes() === before + 1);
    const stored = db.outcomesForTool('mcp:client/adder')[0];
    expect(stored.status).toBe('success');
    expect(stored.latency_ms).toBeGreaterThanOrEqual(20);
    expect(stored.verified).toBe(true);
  });

  it('withOutcome classifies a thrown timeout and rethrows the original error', async () => {
    const tp = new ToolProofClient({ baseUrl: base, identity });
    const before = db.countOutcomes();
    await expect(
      tp.withOutcome(
        { tool_id: 'mcp:client/slowpoke', category: 'testing', task_kind: 'be slow' },
        async () => {
          throw new Error('request timed out after 30000ms');
        },
      ),
    ).rejects.toThrow('timed out');
    await waitFor(() => db.countOutcomes() === before + 1);
    const stored = db.outcomesForTool('mcp:client/slowpoke')[0];
    expect(stored.status).toBe('failure');
    expect(stored.failure_mode).toBe('timeout');
  });

  it('withOutcome honors a custom classifier for in-band failures', async () => {
    const tp = new ToolProofClient({ baseUrl: base, identity });
    const before = db.countOutcomes();
    const result = await tp.withOutcome(
      { tool_id: 'mcp:client/hollow', category: 'testing', task_kind: 'return something' },
      async () => ({ text: '' }),
      {
        classify: (r) =>
          r.text.length > 0
            ? { status: 'success' }
            : { status: 'failure', failure_mode: 'wrong_result', notes: 'empty payload' },
      },
    );
    expect(result).toEqual({ text: '' });
    await waitFor(() => db.countOutcomes() === before + 1);
    const stored = db.outcomesForTool('mcp:client/hollow')[0];
    expect(stored.status).toBe('failure');
    expect(stored.failure_mode).toBe('wrong_result');
  });

  it('never throws from reporting when the server is unreachable', async () => {
    const tp = new ToolProofClient({ baseUrl: 'http://127.0.0.1:1', identity });
    const res = await tp.reportOutcome({
      tool_id: 'mcp:client/void',
      category: 'testing',
      task_kind: 'vanish',
      status: 'success',
      latency_ms: 1,
    });
    expect(res.accepted).toBe(false);
    expect(res.reason).toMatch(/network/);
  });

  it('unsigned client reports land as unverified', async () => {
    const tp = new ToolProofClient({ baseUrl: base });
    const res = await tp.reportOutcome({
      tool_id: 'mcp:client/anon',
      category: 'testing',
      task_kind: 'anonymous report',
      status: 'success',
      latency_ms: 5,
      reporter_id: 'anon-reporter-1',
    });
    expect(res).toMatchObject({ accepted: true, verified: false });
  });
});

async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}
