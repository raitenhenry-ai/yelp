import type { ToolProofDb } from './db.js';
import { scoreTool, starsForOutcome, type ScoringOptions } from './scoring.js';
import { blurbForOutcome, summaryForTool } from './reviews.js';
import type { FeedItem, StoredOutcome, ToolRecord, ToolScore } from './types.js';

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

export async function getToolReviews(
  db: ToolProofDb,
  params: GetToolReviewsParams = {},
  scoring: Partial<ScoringOptions> = {},
): Promise<ToolReview[]> {
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 50);
  const needle = params.capability?.toLowerCase().trim();
  const scoringOpts: Partial<ScoringOptions> = {
    reputation: await db.reporterReputation(),
    ...scoring,
  };

  // Candidate set: rated tools always (there are few, even in a 20k catalog);
  // unrated pages only when explicitly requested, and then bounded by a SQL
  // search so a reviews query never scans the whole catalog (the default path
  // already excluded unrated tools, so this is behavior-preserving + fast).
  const candidates = new Map<string, ToolRecord>();
  for (const id of await db.ratedToolIds(params.category)) {
    const t = await db.getTool(id);
    if (t) candidates.set(id, t);
  }
  if (params.include_unrated) {
    for (const t of await db.searchTools({
      q: params.capability,
      category: params.category,
      limit: 500,
    })) {
      if (!candidates.has(t.tool_id)) candidates.set(t.tool_id, t);
    }
  }

  const scored: (ToolReview & { match: number })[] = [];
  for (const tool of candidates.values()) {
    if (!tool) continue;
    const outcomes = await db.outcomesForTool(tool.tool_id);
    const match = needle ? matchScore(needle, tool, outcomes) : 1;
    if (needle && match === 0) continue;
    if (!params.include_unrated && outcomes.length === 0) continue;
    const s = scoreTool(tool, outcomes, scoringOpts);
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

export async function getToolReport(
  db: ToolProofDb,
  tool_id: string,
  scoring: Partial<ScoringOptions> = {},
): Promise<ToolReport | null> {
  const tool = await db.getTool(tool_id);
  if (!tool) return null;
  const outcomes = await db.outcomesForTool(tool_id);
  const s = scoreTool(tool, outcomes, { reputation: await db.reporterReputation(), ...scoring });
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

export async function getLeaderboard(
  db: ToolProofDb,
  category?: string,
  limit = 20,
  scoring: Partial<ScoringOptions> = {},
): Promise<ToolScore[]> {
  // Only rated tools — with an imported catalog of thousands of unreviewed
  // pages, scoring every row would be wasted work.
  const scoringOpts: Partial<ScoringOptions> = {
    reputation: await db.reporterReputation(),
    ...scoring,
  };
  const scored: ToolScore[] = [];
  for (const id of await db.ratedToolIds(category)) {
    const tool = await db.getTool(id);
    if (tool) scored.push(scoreTool(tool, await db.outcomesForTool(id), scoringOpts));
  }
  scored.sort((a, b) => b.rank_score - a.rank_score);
  return scored.slice(0, limit);
}

export interface DirectoryEntry {
  tool_id: string;
  name: string;
  category: string;
  description: string;
  homepage: string | null;
  n_outcomes: number;
  /** Present only for tools with at least one outcome. */
  score?: ToolScore;
}

export interface DirectoryResult {
  entries: DirectoryEntry[];
  total: number;
  page: number;
  pages: number;
  per_page: number;
}

export async function getDirectory(
  db: ToolProofDb,
  params: { q?: string; category?: string; page?: number; per_page?: number } = {},
  scoring: Partial<ScoringOptions> = {},
): Promise<DirectoryResult> {
  const perPage = Math.min(Math.max(params.per_page ?? 30, 1), 100);
  const total = await db.countTools(params);
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(params.page ?? 1, 1), pages);
  const rows = await db.searchTools({ ...params, limit: perPage, offset: (page - 1) * perPage });
  // Only pull the reputation map if this page actually has rated tools to score.
  const scoringOpts: Partial<ScoringOptions> = rows.some((t) => t.n_outcomes > 0)
    ? { reputation: await db.reporterReputation(), ...scoring }
    : scoring;
  const entries: DirectoryEntry[] = [];
  for (const t of rows) {
    entries.push({
      tool_id: t.tool_id,
      name: t.name,
      category: t.category,
      description: t.description,
      homepage: t.homepage,
      n_outcomes: t.n_outcomes,
      score:
        t.n_outcomes > 0 ? scoreTool(t, await db.outcomesForTool(t.tool_id), scoringOpts) : undefined,
    });
  }
  return { entries, total, page, pages, per_page: perPage };
}

export async function getFeed(
  db: ToolProofDb,
  limit = 50,
  category?: string,
): Promise<FeedItem[]> {
  const outcomes = await db.recentOutcomes(limit, category);
  const items: FeedItem[] = [];
  for (const o of outcomes) {
    const tool = await db.getTool(o.tool_id);
    const reporter = await db.getReporter(o.reporter_id);
    items.push({
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
    });
  }
  return items;
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
