import type { ToolProofDb } from './db.js';
import { scoreTool, starsForOutcome, type ScoringOptions } from './scoring.js';
import { blurbForOutcome, summaryForTool } from './reviews.js';
import type { FeedItem, StoredOutcome, ToolScore } from './types.js';

/**
 * Query layer — what the MCP server and HTTP API expose.
 * The flagship call is getToolReviews: "I need to do X — which tools
 * actually work?", answered from real execution outcomes.
 */

export interface ToolReview extends ToolScore {
  summary: string;
  recent_reviews: { stars: number; verified: boolean; ts: string; blurb: string }[];
}

export interface GetToolReviewsParams {
  /** Free-text capability, matched against tool name/description/category/task history. */
  capability?: string;
  category?: string;
  limit?: number;
  /** Include tools with zero recorded outcomes (default false). */
  include_unrated?: boolean;
}

export function getToolReviews(
  db: ToolProofDb,
  params: GetToolReviewsParams = {},
  scoring: Partial<ScoringOptions> = {},
): ToolReview[] {
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 50);
  const tools = db.listTools(params.category);
  const needle = params.capability?.toLowerCase().trim();

  const scored: (ToolReview & { match: number })[] = [];
  for (const tool of tools) {
    const outcomes = db.outcomesForTool(tool.tool_id);
    const match = needle ? matchScore(needle, tool, outcomes) : 1;
    if (needle && match === 0) continue;
    if (!params.include_unrated && outcomes.length === 0) continue;
    const s = scoreTool(tool, outcomes, scoring);
    scored.push({
      ...s,
      match,
      summary: summaryForTool(s),
      recent_reviews: outcomes.slice(0, 3).map((o) => ({
        stars: starsForOutcome(o),
        verified: o.verified,
        ts: o.ts,
        blurb: blurbForOutcome(o),
      })),
    });
  }

  // Order by evidence-blended quality, using text-match strength as a tiebreaker
  // band: strong matches first, then by rank_score.
  scored.sort((a, b) => b.match - a.match || b.rank_score - a.rank_score);
  return scored.slice(0, limit).map(({ match: _match, ...rest }) => rest);
}

export interface ToolReport extends ToolReview {
  homepage: string | null;
  first_seen: string;
  outcomes_sample: StoredOutcome[];
}

export function getToolReport(
  db: ToolProofDb,
  tool_id: string,
  scoring: Partial<ScoringOptions> = {},
): ToolReport | null {
  const tool = db.getTool(tool_id);
  if (!tool) return null;
  const outcomes = db.outcomesForTool(tool_id);
  const s = scoreTool(tool, outcomes, scoring);
  return {
    ...s,
    summary: summaryForTool(s),
    homepage: tool.homepage,
    first_seen: tool.first_seen,
    recent_reviews: outcomes.slice(0, 10).map((o) => ({
      stars: starsForOutcome(o),
      verified: o.verified,
      ts: o.ts,
      blurb: blurbForOutcome(o),
    })),
    outcomes_sample: outcomes.slice(0, 25),
  };
}

export function getLeaderboard(
  db: ToolProofDb,
  category?: string,
  limit = 20,
  scoring: Partial<ScoringOptions> = {},
): ToolScore[] {
  const tools = db.listTools(category);
  const scored = tools
    .map((t) => scoreTool(t, db.outcomesForTool(t.tool_id), scoring))
    .filter((s) => s.n_outcomes > 0);
  scored.sort((a, b) => b.rank_score - a.rank_score);
  return scored.slice(0, limit);
}

export function getFeed(db: ToolProofDb, limit = 50, category?: string): FeedItem[] {
  const outcomes = db.recentOutcomes(limit, category);
  return outcomes.map((o) => {
    const tool = db.getTool(o.tool_id);
    const reporter = db.getReporter(o.reporter_id);
    return {
      outcome_id: o.outcome_id,
      tool_id: o.tool_id,
      tool_name: tool?.name ?? o.tool_id,
      category: o.category,
      reporter_id: o.reporter_id,
      reporter_label: reporter?.label ?? null,
      verified: o.verified,
      status: o.status,
      stars: starsForOutcome(o),
      blurb: blurbForOutcome(o),
      latency_ms: o.latency_ms,
      ts: o.ts,
    };
  });
}

/**
 * Crude but dependency-free capability matching: token overlap between the
 * query and the tool's name, description, category, and observed task kinds.
 * Good enough to route "extract data from a web page" to web-scraping tools;
 * swap for embeddings when the catalog grows.
 */
function matchScore(
  needle: string,
  tool: { name: string; description: string; category: string; tool_id: string },
  outcomes: StoredOutcome[],
): number {
  const taskKinds = [...new Set(outcomes.slice(0, 200).map((o) => o.task_kind))].join(' ');
  const haystack =
    `${tool.name} ${tool.description} ${tool.category} ${tool.tool_id} ${taskKinds}`.toLowerCase();
  const tokens = needle.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  if (tokens.length === 0) return haystack.includes(needle) ? 1 : 0;
  let hits = 0;
  for (const t of tokens) if (haystack.includes(t)) hits++;
  return hits / tokens.length;
}
