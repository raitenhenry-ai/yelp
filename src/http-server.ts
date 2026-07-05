import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { ToolProofDb } from './db.js';
import { ingestOutcome } from './ingest.js';
import { buildMcpServer } from './mcp-server.js';
import { getDirectory, getFeed, getLeaderboard, getToolReport, getToolReviews } from './query.js';
import { feedPageHtml } from './web/feed-page.js';
import { landingPageHtml } from './web/landing-page.js';
import { directoryPageHtml } from './web/directory-page.js';
import { toolPageHtml } from './web/tool-page.js';

/**
 * Minimal dependency-free HTTP surface:
 *   GET  /                      — landing page (live stats + embedded observatory)
 *   GET  /feed                  — the full human-watchable feed page
 *   GET  /tools                 — browsable directory (q, category, page)
 *   GET  /tool/:tool_id         — tool profile page (exists for ANY id; first review persists it)
 *   GET  /api/directory         — directory as JSON (q, category, page, per_page)
 *   ALL  /mcp                   — remote MCP endpoint (Streamable HTTP, stateless)
 *   GET  /healthz               — liveness + headline counts
 *   GET  /api/feed              — recent reviews (limit, category)
 *   GET  /api/tools             — get_tool_reviews (capability, category, limit)
 *   GET  /api/tools/:tool_id    — full report (tool_id is URL-encoded)
 *   GET  /api/leaderboard       — ranked tools (category, limit)
 *   GET  /api/categories        — categories
 *   GET  /api/stats             — headline counts
 *   POST /api/outcomes          — submit a (signed) outcome
 */
export function buildHttpServer(db: ToolProofDb, siteName = 'ToolProof'): Server {
  return createServer(async (req, res) => {
    try {
      await route(db, siteName, req, res);
    } catch (err) {
      if (!res.headersSent) {
        sendJson(res, 500, { error: err instanceof Error ? err.message : 'internal error' });
      } else {
        res.end();
      }
    }
  });
}

/**
 * Stateless remote MCP: each request gets a fresh server + transport pair
 * (cheap — no I/O at construction), so any load balancer works and no session
 * affinity is needed. GET/DELETE get the spec-mandated 405 from the SDK.
 */
async function handleMcp(
  db: ToolProofDb,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = buildMcpServer(db);
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  let body: unknown;
  if (req.method === 'POST') {
    const raw = await readBody(req, 256 * 1024);
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' });
      return;
    }
  }
  await transport.handleRequest(req, res, body);
}

async function route(
  db: ToolProofDb,
  siteName: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const q = url.searchParams;

  if (req.method === 'GET' && path === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(landingPageHtml(siteName));
    return;
  }

  if (req.method === 'GET' && path === '/feed') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(feedPageHtml(siteName));
    return;
  }

  if (req.method === 'GET' && path === '/tools') {
    const result = getDirectory(db, {
      q: q.get('q') ?? undefined,
      category: q.get('category') ?? undefined,
      page: intParam(q, 'page', 1, 100_000),
      per_page: intParam(q, 'per_page', 30, 100),
    });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      directoryPageHtml(
        siteName,
        result,
        { q: q.get('q') ?? undefined, category: q.get('category') ?? undefined },
        db.listCategories(),
      ),
    );
    return;
  }

  if (req.method === 'GET' && path.startsWith('/tool/')) {
    const toolId = decodeURIComponent(path.slice('/tool/'.length));
    if (!toolId || toolId.length > 256) {
      sendJson(res, 404, { error: 'bad tool id' });
      return;
    }
    // Every conceivable tool_id has a page. Known tools render their
    // evidence; unknown ones render an invitation — the first submitted
    // review persists the page (ingest auto-registers unknown tools).
    const report =
      getToolReport(db, toolId) ??
      ({
        tool_id: toolId,
        name: toolId.split(/[/#]/).pop() ?? toolId,
        category: 'uncategorized',
        description: '',
        homepage: null,
        first_seen: new Date().toISOString(),
        score: 0.5,
        confidence: 0,
        rank_score: 0.5,
        stars: 3,
        n_outcomes: 0,
        n_verified: 0,
        n_reporters: 0,
        success_rate: 0,
        latency_p50_ms: null,
        trend: 'insufficient' as const,
        last_outcome_at: null,
        top_failure_mode: null,
        summary: '',
        recent_reviews: [],
        outcomes_sample: [],
      } satisfies ReturnType<typeof getToolReport> & object);
    const failures = new Map<string, number>();
    for (const o of report.outcomes_sample.length
      ? db.outcomesForTool(toolId)
      : []) {
      if (o.status === 'failure') {
        const mode = o.failure_mode ?? 'other';
        failures.set(mode, (failures.get(mode) ?? 0) + 1);
      }
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      toolPageHtml(siteName, {
        report,
        siblings: db.siblingTools(toolId),
        failureBreakdown: [...failures.entries()]
          .map(([mode, count]) => ({ mode, count }))
          .sort((a, b) => b.count - a.count),
      }),
    );
    return;
  }

  if (path === '/mcp') {
    await handleMcp(db, req, res);
    return;
  }

  if (req.method === 'GET' && path === '/healthz') {
    sendJson(res, 200, { ok: true, outcomes: db.countOutcomes(), uptime_s: process.uptime() });
    return;
  }

  if (req.method === 'GET' && path === '/api/feed') {
    sendJson(res, 200, {
      feed: getFeed(db, intParam(q, 'limit', 50, 200), q.get('category') ?? undefined),
    });
    return;
  }

  if (req.method === 'GET' && path === '/api/tools') {
    sendJson(res, 200, {
      results: getToolReviews(db, {
        capability: q.get('capability') ?? undefined,
        category: q.get('category') ?? undefined,
        limit: intParam(q, 'limit', 10, 50),
        include_unrated: q.get('include_unrated') === 'true',
      }),
    });
    return;
  }

  if (req.method === 'GET' && path.startsWith('/api/tools/')) {
    const toolId = decodeURIComponent(path.slice('/api/tools/'.length));
    const report = getToolReport(db, toolId);
    if (!report) {
      sendJson(res, 404, { error: `unknown tool_id: ${toolId}` });
      return;
    }
    sendJson(res, 200, report);
    return;
  }

  if (req.method === 'GET' && path === '/api/leaderboard') {
    sendJson(res, 200, {
      leaderboard: getLeaderboard(db, q.get('category') ?? undefined, intParam(q, 'limit', 20, 50)),
    });
    return;
  }

  if (req.method === 'GET' && path === '/api/directory') {
    sendJson(
      res,
      200,
      getDirectory(db, {
        q: q.get('q') ?? undefined,
        category: q.get('category') ?? undefined,
        page: intParam(q, 'page', 1, 100_000),
        per_page: intParam(q, 'per_page', 30, 100),
      }),
    );
    return;
  }

  if (req.method === 'GET' && path === '/api/categories') {
    sendJson(res, 200, { categories: db.listCategories() });
    return;
  }

  if (req.method === 'GET' && path === '/api/stats') {
    const categories = db.listCategories();
    const outcomes = db.countOutcomes();
    const verifiedRow = db.db
      .prepare('SELECT COUNT(*) AS n FROM outcomes WHERE verified = 1')
      .get() as { n: number };
    sendJson(res, 200, {
      outcomes,
      tools: categories.reduce((a, c) => a + c.n_tools, 0),
      categories: categories.length,
      verified_share: outcomes > 0 ? verifiedRow.n / outcomes : 0,
    });
    return;
  }

  if (req.method === 'POST' && path === '/api/outcomes') {
    const body = await readBody(req, 64 * 1024);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' });
      return;
    }
    const result = ingestOutcome(db, parsed);
    sendJson(res, result.accepted ? 201 : 422, result);
    return;
  }

  sendJson(res, 404, { error: 'not found' });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
  });
  res.end(body);
}

function intParam(q: URLSearchParams, name: string, dflt: number, max: number): number {
  const raw = q.get(name);
  if (!raw) return dflt;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), max) : dflt;
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
