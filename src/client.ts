import { randomUUID } from 'node:crypto';
import { signOutcome, type ReporterIdentity } from './signing.js';
import type { ExecutionOutcome, FeedItem, IngestResult, ToolScore } from './types.js';
import type { ToolReport, ToolReview } from './query.js';

/**
 * HTTP client for agents. Two ways to integrate:
 *
 *   1. Ask before choosing:   client.getToolReviews({ capability: '…' })
 *   2. Report after using:    client.reportOutcome({ … })  — signed automatically
 *
 * Or wrap the tool call itself and let Filterly time and classify it:
 *
 *   const result = await client.withOutcome(
 *     { tool_id: 'mcp:acme/scraper#extract', category: 'web-scraping',
 *       task_kind: 'extract article text' },
 *     () => scraper.extract(url),
 *   );
 */
export interface FilterlyClientOptions {
  baseUrl: string;
  /** Identity used to sign outcomes. Omit to submit unverified (low-weight) reports. */
  identity?: ReporterIdentity;
  fetchFn?: typeof fetch;
}

export interface OutcomeContext {
  tool_id: string;
  category: string;
  task_kind: string;
  tool_name?: string;
  session_fingerprint?: string;
}

export interface WithOutcomeOptions<T> {
  /**
   * Map a resolved value to outcome fields. Default: any resolved value is a
   * full-quality success. Return `status: 'failure'` for in-band failures
   * (e.g. a tool that "succeeds" with an empty payload).
   */
  classify?: (result: T) => Partial<Pick<ExecutionOutcome, 'status' | 'quality' | 'failure_mode' | 'notes'>>;
  /** Map a thrown error to a failure mode. Default heuristic: timeouts vs runtime errors. */
  classifyError?: (err: unknown) => Partial<Pick<ExecutionOutcome, 'failure_mode' | 'notes'>>;
  cost_usd?: number;
}

export class FilterlyClient {
  private readonly baseUrl: string;
  private readonly identity?: ReporterIdentity;
  private readonly fetchFn: typeof fetch;
  /** Fallback reporter id for identity-less clients: unique per instance so
   * distinct anonymous clients don't all merge into one shared 'anonymous'
   * bucket (these reports are unverified and low-weight regardless). */
  private readonly anonReporterId: string;

  constructor(opts: FilterlyClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.identity = opts.identity;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.anonReporterId = `anon-${randomUUID()}`;
  }

  async getToolReviews(params: {
    capability?: string;
    category?: string;
    limit?: number;
  }): Promise<ToolReview[]> {
    const q = new URLSearchParams();
    if (params.capability) q.set('capability', params.capability);
    if (params.category) q.set('category', params.category);
    if (params.limit) q.set('limit', String(params.limit));
    const body = await this.get(`/api/tools?${q}`);
    return (body as { results: ToolReview[] }).results;
  }

  /** Full report for a tool, or null if the server has no such tool (404) —
   * mirrors the library's getToolReport, which returns null for unknown ids. */
  async getToolReport(toolId: string): Promise<ToolReport | null> {
    const res = await this.fetchFn(`${this.baseUrl}/api/tools/${encodeURIComponent(toolId)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`filterly: GET /api/tools/${toolId} → ${res.status}`);
    return (await res.json()) as ToolReport;
  }

  async getLeaderboard(category?: string, limit?: number): Promise<ToolScore[]> {
    const q = new URLSearchParams();
    if (category) q.set('category', category);
    if (limit) q.set('limit', String(limit));
    return ((await this.get(`/api/leaderboard?${q}`)) as { leaderboard: ToolScore[] }).leaderboard;
  }

  async getFeed(limit?: number): Promise<FeedItem[]> {
    const q = limit ? `?limit=${limit}` : '';
    return ((await this.get(`/api/feed${q}`)) as { feed: FeedItem[] }).feed;
  }

  /**
   * Submit an outcome. Fills in outcome_id/ts/reporter_id and signs it when
   * an identity is configured. Never throws on server rejection — returns the
   * IngestResult so reporting can't break the agent's real task.
   */
  async reportOutcome(
    outcome: Omit<ExecutionOutcome, 'outcome_id' | 'ts' | 'reporter_id'> &
      Partial<Pick<ExecutionOutcome, 'outcome_id' | 'ts' | 'reporter_id'>>,
  ): Promise<IngestResult> {
    const full: ExecutionOutcome = {
      outcome_id: outcome.outcome_id ?? randomUUID(),
      ts: outcome.ts ?? new Date().toISOString(),
      reporter_id: outcome.reporter_id ?? this.identity?.reporter_id ?? this.anonReporterId,
      ...outcome,
    } as ExecutionOutcome;
    const payload = this.identity ? signOutcome(full, this.identity) : { outcome: full };
    try {
      const res = await this.fetchFn(`${this.baseUrl}/api/outcomes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return (await res.json()) as IngestResult;
    } catch (err) {
      return {
        accepted: false,
        verified: false,
        reason: `network: ${err instanceof Error ? err.message : String(err)}`,
        outcome_id: full.outcome_id,
      };
    }
  }

  /**
   * Wrap a tool call: times it, classifies the result or the thrown error,
   * reports the outcome (fire-and-forget), and returns/rethrows transparently.
   * The wrapper never swallows the tool's behavior and never fails the task
   * because reporting failed.
   */
  async withOutcome<T>(
    ctx: OutcomeContext,
    fn: () => Promise<T>,
    opts: WithOutcomeOptions<T> = {},
  ): Promise<T> {
    const t0 = Date.now();
    try {
      const result = await fn();
      const classified = opts.classify?.(result) ?? {};
      void this.reportOutcome({
        ...ctx,
        status: 'success',
        quality: 1,
        ...classified,
        latency_ms: Date.now() - t0,
        cost_usd: opts.cost_usd,
      });
      return result;
    } catch (err) {
      const classified = opts.classifyError?.(err) ?? defaultErrorClassifier(err);
      void this.reportOutcome({
        ...ctx,
        status: 'failure',
        ...classified,
        latency_ms: Date.now() - t0,
        cost_usd: opts.cost_usd,
      });
      throw err;
    }
  }

  private async get(path: string): Promise<unknown> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`);
    if (!res.ok) throw new Error(`filterly: GET ${path} → ${res.status}`);
    return res.json();
  }
}

function defaultErrorClassifier(
  err: unknown,
): Partial<Pick<ExecutionOutcome, 'failure_mode' | 'notes'>> {
  const msg = err instanceof Error ? err.message : String(err);
  const failure_mode = /timeout|timed out|ETIMEDOUT|deadline/i.test(msg)
    ? 'timeout'
    : /ECONNREFUSED|ENOTFOUND|unavailable|503/i.test(msg)
      ? 'unavailable'
      : /401|403|unauthorized|forbidden|auth/i.test(msg)
        ? 'auth_error'
        : /429|rate.?limit/i.test(msg)
          ? 'rate_limited'
          : 'runtime_error';
  return { failure_mode, notes: msg.slice(0, 280) };
}
