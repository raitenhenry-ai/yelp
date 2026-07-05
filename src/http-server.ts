import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { ToolProofDb } from './db.js';
import { ingestOutcome } from './ingest.js';
import { getFeed, getLeaderboard, getToolReport, getToolReviews } from './query.js';
import { feedPageHtml } from './web/feed-page.js';

/**
 * Minimal dependency-free HTTP surface:
 *   GET  /                      — the human-watchable feed page
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
      sendJson(res, 500, { error: err instanceof Error ? err.message : 'internal error' });
    }
  });
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
    res.end(feedPageHtml(siteName));
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
