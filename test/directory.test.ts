import { describe, expect, it } from 'vitest';
import { categorizeText } from '../src/catalog.js';
import { importMcpRegistry, importNpm } from '../src/import/sources.js';
import { ingestOutcome } from '../src/ingest.js';
import { getDirectory } from '../src/query.js';
import { memDb, outcome } from './helpers.js';

describe('categorizeText', () => {
  it('maps descriptions to sensible categories', () => {
    expect(categorizeText('Scrape any web page into markdown')).toBe('web-scraping');
    expect(categorizeText('Query your Postgres database')).toBe('databases');
    expect(categorizeText('Create Stripe payment intents')).toBe('payments');
    expect(categorizeText('Control a headless browser')).toBe('browser-automation');
    expect(categorizeText('A thing that defies description entirely')).toBe('uncategorized');
  });
});

describe('getDirectory', () => {
  async function seeded() {
    const db = await memDb();
    await db.upsertTool({
      tool_id: 'mcp:rated/one',
      name: 'Rated One',
      category: 'search',
      description: 'A search tool with evidence',
      homepage: null,
    });
    await db.upsertTool({
      tool_id: 'mcp:unrated/two',
      name: 'Unrated Two',
      category: 'search',
      description: 'Imported, never reviewed',
      homepage: null,
    });
    await ingestOutcome(db, {
      outcome: outcome({ tool_id: 'mcp:rated/one', tool_name: 'Rated One', category: 'search' }),
    });
    return db;
  }

  it('lists rated tools first and includes unrated pages', async () => {
    const dir = await getDirectory(await seeded());
    expect(dir.total).toBe(2);
    expect(dir.entries[0].tool_id).toBe('mcp:rated/one');
    expect(dir.entries[0].score?.n_outcomes).toBe(1);
    expect(dir.entries[1].tool_id).toBe('mcp:unrated/two');
    expect(dir.entries[1].score).toBeUndefined();
  });

  it('searches by name/description and filters by category', async () => {
    const db = await seeded();
    expect((await getDirectory(db, { q: 'never reviewed' })).entries.map((e) => e.tool_id)).toEqual([
      'mcp:unrated/two',
    ]);
    expect((await getDirectory(db, { category: 'search' })).total).toBe(2);
    expect((await getDirectory(db, { category: 'payments' })).total).toBe(0);
  });

  it('paginates', async () => {
    const db = await seeded();
    const p1 = await getDirectory(db, { per_page: 1, page: 1 });
    const p2 = await getDirectory(db, { per_page: 1, page: 2 });
    expect(p1.pages).toBe(2);
    expect(p1.entries[0].tool_id).not.toBe(p2.entries[0].tool_id);
  });
});

describe('auto-page-on-review', () => {
  it('a review of a never-seen tool creates its directory page', async () => {
    const db = await memDb();
    expect(await db.getTool('mcp:brand/new')).toBeNull();
    const res = await ingestOutcome(db, {
      outcome: outcome({
        tool_id: 'mcp:brand/new',
        tool_name: 'Brand New Tool',
        category: 'testing',
      }),
    });
    expect(res.accepted).toBe(true);
    const page = await db.getTool('mcp:brand/new');
    expect(page?.name).toBe('Brand New Tool');
    expect((await getDirectory(db, { q: 'brand new' })).entries[0].n_outcomes).toBe(1);
  });
});

describe('importers (mocked registries)', () => {
  it('imports latest-active MCP registry servers with pagination and categorization', async () => {
    const db = await memDb();
    const pages = [
      {
        servers: [
          {
            server: { name: 'io.github.a/scraper', description: 'Scrape web pages' },
            _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true, status: 'active' } },
          },
          {
            server: { name: 'io.github.a/scraper', description: 'old version' },
            _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: false, status: 'active' } },
          },
        ],
        metadata: { nextCursor: 'c2' },
      },
      {
        servers: [
          {
            server: {
              name: 'io.github.b/pg',
              title: 'Postgres MCP',
              description: 'Query postgres databases',
              repository: { url: 'https://github.com/b/pg' },
            },
            _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true, status: 'active' } },
          },
        ],
        metadata: {},
      },
    ];
    let call = 0;
    const fetchFn = (async () =>
      new Response(JSON.stringify(pages[call++]), { status: 200 })) as typeof fetch;

    const stats = await importMcpRegistry(db, { fetchFn });
    expect(stats).toMatchObject({ seen: 3, created: 2 });
expect((await db.getTool('mcp:io.github.a/scraper'))?.category).toBe('web-scraping');
    const pg = await db.getTool('mcp:io.github.b/pg');
    expect(pg?.name).toBe('Postgres MCP');
    expect(pg?.category).toBe('databases');
    expect(pg?.homepage).toBe('https://github.com/b/pg');
  });

  it('imports npm packages and never clobbers existing pages', async () => {
    const db = await memDb();
    await db.upsertTool({
      tool_id: 'mcp:npm/already-here',
      name: 'Curated Name',
      category: 'payments',
      description: 'curated description',
      homepage: 'https://curated.example',
    });
    const body = {
      objects: [
        { package: { name: 'already-here', description: 'auto description', links: {} } },
        {
          package: {
            name: 'fresh-scraper',
            description: 'Crawl and extract pages',
            links: { homepage: 'https://fresh.example' },
          },
        },
      ],
      total: 2,
    };
    const fetchFn = (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
    const stats = await importNpm(db, { fetchFn });
    expect(stats).toMatchObject({ seen: 2, created: 1, updated: 1 });
    const kept = await db.getTool('mcp:npm/already-here');
    expect(kept?.name).toBe('Curated Name');
    expect(kept?.category).toBe('payments');
    expect(kept?.description).toBe('curated description');
expect((await db.getTool('mcp:npm/fresh-scraper'))?.category).toBe('web-scraping');
  });
});
