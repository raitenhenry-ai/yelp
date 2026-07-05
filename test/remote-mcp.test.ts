import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { openDb, type ToolProofDb } from '../src/db.js';
import { buildHttpServer } from '../src/http-server.js';
import { generateReporterIdentity, signOutcome } from '../src/signing.js';
import { outcome } from './helpers.js';

let server: Server;
let base: string;
let db: ToolProofDb;

beforeAll(async () => {
  db = await openDb(':memory:');
  server = buildHttpServer(db);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(async () => {
  server.close();
  await db.close();
});

describe('remote MCP endpoint (/mcp, streamable HTTP)', () => {
  it('serves the full agent loop over the network: review → use → report', async () => {
    const client = new Client({ name: 'remote-agent', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('get_tool_reviews');

    const identity = generateReporterIdentity();
    const o = outcome({
      reporter_id: identity.reporter_id,
      tool_id: 'mcp:remote/translator',
      tool_name: 'Remote Translator',
      category: 'translation',
      task_kind: 'translate a paragraph',
    });
    const signed = signOutcome(o, identity);
    const submit = (await client.callTool({
      name: 'submit_outcome',
      arguments: { outcome: o, public_key: signed.public_key, signature: signed.signature },
    })) as { content: { text: string }[] };
    expect(JSON.parse(submit.content[0].text)).toMatchObject({ accepted: true, verified: true });

    const reviews = (await client.callTool({
      name: 'get_tool_reviews',
      arguments: { capability: 'translate a paragraph' },
    })) as { content: { text: string }[] };
    const parsed = JSON.parse(reviews.content[0].text) as { results: { tool_id: string }[] };
    expect(parsed.results[0].tool_id).toBe('mcp:remote/translator');

    await client.close();
  });

  it('handles concurrent stateless clients', async () => {
    const clients = await Promise.all(
      Array.from({ length: 4 }, async (_, i) => {
        const c = new Client({ name: `agent-${i}`, version: '1.0.0' });
        await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
        return c;
      }),
    );
    const results = await Promise.all(
      clients.map((c) => c.callTool({ name: 'list_categories', arguments: {} })),
    );
    expect(results).toHaveLength(4);
    await Promise.all(clients.map((c) => c.close()));
  });

  it('rejects invalid JSON with 400', async () => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
  });
});

describe('/healthz', () => {
  it('reports liveness', async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
