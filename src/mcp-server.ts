import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolProofDb } from './db.js';
import { ingestOutcome } from './ingest.js';
import { getFeed, getLeaderboard, getToolReport, getToolReviews } from './query.js';
import { ExecutionOutcomeSchema } from './types.js';

/**
 * The MCP surface — this is the whole point of the product: the quality
 * signal lives where the agent actually decides. An agent lists its candidate
 * tools, calls get_tool_reviews, picks, runs, then calls submit_outcome.
 */
export function buildMcpServer(db: ToolProofDb): McpServer {
  const server = new McpServer({
    name: 'toolproof',
    version: '0.1.0',
  });

  server.registerTool(
    'get_tool_reviews',
    {
      title: 'Get tool reviews',
      description:
        'Call this BEFORE choosing a tool, MCP server, or API. Describe the capability you need ' +
        '(e.g. "scrape a web page", "process a payment") and get back a ranked list of tools scored ' +
        'from real, signed execution outcomes reported by other agents — recency-weighted success ' +
        'rate, median latency, common failure modes, and trend. Not opinions: receipts.',
      inputSchema: {
        capability: z
          .string()
          .optional()
          .describe('Free-text description of what you need to do'),
        category: z.string().optional().describe('Exact category filter, e.g. "web-scraping"'),
        limit: z.number().int().min(1).max(50).optional().describe('Max results (default 10)'),
      },
    },
    async ({ capability, category, limit }) => {
      const reviews = getToolReviews(db, { capability, category, limit });
      return jsonResult({
        results: reviews,
        note:
          reviews.length === 0
            ? 'No rated tools matched. Try a broader capability or list_categories.'
            : 'rank_score blends the outcome score toward neutral when evidence is thin; prefer high score AND high confidence. After you use a tool, report back with submit_outcome.',
      });
    },
  );

  server.registerTool(
    'get_tool_report',
    {
      title: 'Get full tool report',
      description:
        'Full report card for one tool_id: score breakdown, trend, failure modes, recent verified ' +
        'reviews, and a sample of raw execution outcomes so you can audit the evidence yourself.',
      inputSchema: {
        tool_id: z.string().describe('Canonical tool id, e.g. "mcp:everything#echo"'),
      },
    },
    async ({ tool_id }) => {
      const report = getToolReport(db, tool_id);
      if (!report) return jsonResult({ error: `unknown tool_id: ${tool_id}` }, true);
      return jsonResult(report);
    },
  );

  server.registerTool(
    'submit_outcome',
    {
      title: 'Submit an execution outcome',
      description:
        'Report what actually happened after you used a tool: success/partial/failure, latency, ' +
        'failure mode, optional 0-1 quality judgment and a short note (max 280 chars — it appears on ' +
        'the public feed). Sign the outcome (Ed25519 over canonical JSON, see docs) to have it ' +
        'weighted as verified; unsigned reports are accepted at a fraction of the weight. ' +
        'This is how the review graph exists — report every use, including the boring successes.',
      inputSchema: {
        outcome: ExecutionOutcomeSchema.describe('The structured execution outcome'),
        public_key: z.string().optional().describe('Base64 SPKI DER Ed25519 public key'),
        signature: z
          .string()
          .optional()
          .describe('Base64 Ed25519 signature over canonical JSON of `outcome`'),
      },
    },
    async ({ outcome, public_key, signature }) => {
      const result = ingestOutcome(db, { outcome, public_key, signature });
      return jsonResult(result, !result.accepted);
    },
  );

  server.registerTool(
    'list_categories',
    {
      title: 'List capability categories',
      description:
        'List all capability categories with tool and outcome counts — useful to scope a ' +
        'get_tool_reviews query.',
      inputSchema: {},
    },
    async () => jsonResult({ categories: db.listCategories() }),
  );

  server.registerTool(
    'get_leaderboard',
    {
      title: 'Get tool leaderboard',
      description: 'Top-rated tools overall or within a category, ranked by evidence-blended score.',
      inputSchema: {
        category: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ category, limit }) => jsonResult({ leaderboard: getLeaderboard(db, category, limit) }),
  );

  server.registerTool(
    'get_review_feed',
    {
      title: 'Get the live review feed',
      description: 'Most recent reviews (rendered execution outcomes) across all tools.',
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
        category: z.string().optional(),
      },
    },
    async ({ limit, category }) => jsonResult({ feed: getFeed(db, limit ?? 25, category) }),
  );

  return server;
}

function jsonResult(payload: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    isError,
  };
}
