import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { openDb, type FilterlyDb } from '../src/db.js';
import { buildHttpServer } from '../src/http-server.js';
import { ingestOutcome } from '../src/ingest.js';
import { outcome } from './helpers.js';

let server: Server;
let base: string;
let db: FilterlyDb;

beforeAll(async () => {
  db = await openDb(':memory:');
  await db.upsertTool({
    tool_id: 'mcp:acme/server',
    name: 'Acme Server',
    category: 'search',
    description: 'The acme of search servers',
    homepage: 'https://acme.example',
  });
  await db.upsertTool({
    tool_id: 'mcp:acme/server#lookup',
    name: 'Acme Server › lookup',
    category: 'search',
    description: '',
    homepage: null,
  });
  await ingestOutcome(db, {
    outcome: outcome({
      tool_id: 'mcp:acme/server#lookup',
      tool_name: 'Acme Server › lookup',
      category: 'search',
      task_kind: 'look something up',
      status: 'failure',
      failure_mode: 'timeout',
    }),
  });
  server = buildHttpServer(db, 'Filterly Test');
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(async () => {
  server.close();
  await db.close();
});

describe('directory page (/tools)', () => {
  it('renders all pages including unrated, with search', async () => {
    const html = await (await fetch(`${base}/tools`)).text();
    expect(html).toContain('Acme Server');
    expect(html).toContain('no reviews yet');
    const filtered = await (await fetch(`${base}/tools?q=acme+of+search`)).text();
    expect(filtered).toContain('The acme of search servers');
  });

  it('serves the directory as JSON', async () => {
    const body = (await (await fetch(`${base}/api/directory?q=acme`)).json()) as {
      total: number;
      entries: { tool_id: string }[];
    };
    expect(body.total).toBe(2);
  });
});

describe('tool profile pages (/tool/:id)', () => {
  it('renders a rated tool page with evidence and failure modes', async () => {
    const html = await (
      await fetch(`${base}/tool/${encodeURIComponent('mcp:acme/server#lookup')}`)
    ).text();
    expect(html).toContain('Acme Server › lookup');
    expect(html).toContain('recent reviews');
    expect(html).toContain('timeout');
    expect(html).toContain('raw evidence');
  });

  it('shows siblings from the same server', async () => {
    const html = await (
      await fetch(`${base}/tool/${encodeURIComponent('mcp:acme/server#lookup')}`)
    ).text();
    expect(html).toContain('from the same server');
    expect(html).toContain('Acme Server</a>');
  });

  it('renders an invitation page for a tool nobody has ever mentioned', async () => {
    const res = await fetch(`${base}/tool/${encodeURIComponent('mcp:ghost/never-seen')}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('no execution evidence yet');
    expect(html).toContain('mcp:ghost/never-seen');
    expect(html).toContain('submit_outcome');
  });

  it('the invitation page becomes a real rated page after one review', async () => {
    const res = await fetch(`${base}/api/outcomes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        outcome: outcome({
          tool_id: 'mcp:ghost/never-seen',
          tool_name: 'Ghost Tool',
          category: 'testing',
        }),
      }),
    });
    expect(res.status).toBe(201);
    const html = await (
      await fetch(`${base}/tool/${encodeURIComponent('mcp:ghost/never-seen')}`)
    ).text();
    expect(html).toContain('Ghost Tool');
    expect(html).not.toContain('no execution evidence yet');
    expect(html).toContain('recorded execution');
    // and it's in the directory now
    const dir = await (await fetch(`${base}/tools?q=ghost+tool`)).text();
    expect(dir).toContain('Ghost Tool');
  });

  it('escapes hostile tool ids', async () => {
    const evil = 'mcp:<script>alert(1)</script>';
    const html = await (await fetch(`${base}/tool/${encodeURIComponent(evil)}`)).text();
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });
});
