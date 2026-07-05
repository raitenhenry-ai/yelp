import { beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { openDb, type FilterlyDb } from '../src/db.js';
import { buildMcpServer } from '../src/mcp-server.js';
import { generateReporterIdentity, signOutcome } from '../src/signing.js';
import { outcome } from './helpers.js';

let db: FilterlyDb;
let client: Client;

beforeAll(async () => {
  db = await openDb(':memory:');
  const server = buildMcpServer(db);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-agent', version: '0.0.1' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

function text(result: unknown): string {
  const r = result as { content: { type: string; text: string }[] };
  return r.content.map((c) => c.text).join('\n');
}

describe('Filterly MCP server', () => {
  it('exposes the review tools', async () => {
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'get_leaderboard',
      'get_review_feed',
      'get_tool_report',
      'get_tool_reviews',
      'list_categories',
      'submit_outcome',
    ]);
  });

  it('round-trips: submit_outcome then get_tool_reviews finds the tool', async () => {
    const identity = generateReporterIdentity();
    const o = outcome({
      reporter_id: identity.reporter_id,
      tool_id: 'mcp:demo/summarizer',
      tool_name: 'Demo Summarizer',
      category: 'summarization',
      task_kind: 'summarize a document',
    });
    const signed = signOutcome(o, identity);
    const submit = await client.callTool({
      name: 'submit_outcome',
      arguments: { outcome: o, public_key: signed.public_key, signature: signed.signature },
    });
    expect(JSON.parse(text(submit))).toMatchObject({ accepted: true, verified: true });

    const reviews = await client.callTool({
      name: 'get_tool_reviews',
      arguments: { capability: 'summarize documents' },
    });
    const parsed = JSON.parse(text(reviews)) as { results: { tool_id: string; stars: number }[] };
    expect(parsed.results[0].tool_id).toBe('mcp:demo/summarizer');

    const report = await client.callTool({
      name: 'get_tool_report',
      arguments: { tool_id: 'mcp:demo/summarizer' },
    });
    expect(JSON.parse(text(report)).n_verified).toBe(1);
  });

  it('rejects forged submissions through the MCP surface', async () => {
    const identity = generateReporterIdentity();
    const o = outcome({ reporter_id: identity.reporter_id, tool_id: 'mcp:demo/summarizer' });
    const signed = signOutcome(o, identity);
    const forged = { ...o, status: 'success' as const, quality: 1 };
    const res = (await client.callTool({
      name: 'submit_outcome',
      arguments: { outcome: forged, public_key: signed.public_key, signature: signed.signature },
    })) as { isError?: boolean };
    expect(res.isError).toBe(true);
  });

  it('lists categories', async () => {
    const res = await client.callTool({ name: 'list_categories', arguments: {} });
    const parsed = JSON.parse(text(res)) as { categories: { category: string }[] };
    expect(parsed.categories.map((c) => c.category)).toContain('summarization');
  });
});
