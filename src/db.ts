import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ExecutionOutcome, ReporterRecord, StoredOutcome, ToolRecord } from './types.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tools (
  tool_id     TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  homepage    TEXT,
  first_seen  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reporters (
  reporter_id TEXT PRIMARY KEY,
  public_key  TEXT,
  label       TEXT,
  kind        TEXT NOT NULL DEFAULT 'agent',
  first_seen  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outcomes (
  outcome_id  TEXT PRIMARY KEY,
  tool_id     TEXT NOT NULL,
  reporter_id TEXT NOT NULL,
  ts          TEXT NOT NULL,
  received_at TEXT NOT NULL,
  status      TEXT NOT NULL,
  failure_mode TEXT,
  quality     REAL,
  latency_ms  REAL NOT NULL,
  cost_usd    REAL,
  category    TEXT NOT NULL,
  task_kind   TEXT NOT NULL,
  verified    INTEGER NOT NULL DEFAULT 0,
  session_fingerprint TEXT,
  notes       TEXT
);
CREATE INDEX IF NOT EXISTS idx_outcomes_tool_ts ON outcomes (tool_id, ts);
CREATE INDEX IF NOT EXISTS idx_outcomes_reporter_ts ON outcomes (reporter_id, ts);
CREATE INDEX IF NOT EXISTS idx_outcomes_received ON outcomes (received_at);
`;

export class ToolProofDb {
  readonly db: DatabaseSync;

  constructor(path: string = process.env.TOOLPROOF_DB ?? 'toolproof.db') {
    if (path !== ':memory:') mkdirSync(dirname(path) || '.', { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // ---- tools -------------------------------------------------------------

  upsertTool(tool: Omit<ToolRecord, 'first_seen'> & { first_seen?: string }): void {
    this.db
      .prepare(
        `INSERT INTO tools (tool_id, name, category, description, homepage, first_seen)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(tool_id) DO UPDATE SET
           name = excluded.name,
           category = excluded.category,
           description = CASE WHEN excluded.description != '' THEN excluded.description ELSE tools.description END,
           homepage = COALESCE(excluded.homepage, tools.homepage)`,
      )
      .run(
        tool.tool_id,
        tool.name,
        tool.category,
        tool.description,
        tool.homepage,
        tool.first_seen ?? new Date().toISOString(),
      );
  }

  /** Register a tool only if unknown (used by ingest auto-registration). */
  ensureTool(tool_id: string, name: string, category: string): void {
    this.db
      .prepare(
        `INSERT INTO tools (tool_id, name, category, description, homepage, first_seen)
         VALUES (?, ?, ?, '', NULL, ?) ON CONFLICT(tool_id) DO NOTHING`,
      )
      .run(tool_id, name, category, new Date().toISOString());
  }

  /**
   * Register a tool from a catalog import: creates the page if new, and only
   * fills in description/homepage/category where they're missing — an import
   * never clobbers a curated record or a category chosen by real reviews.
   */
  registerImportedTool(tool: {
    tool_id: string;
    name: string;
    category: string;
    description: string;
    homepage?: string | null;
  }): boolean {
    const existing = this.getTool(tool.tool_id);
    if (!existing) {
      this.upsertTool({ ...tool, homepage: tool.homepage ?? null });
      return true;
    }
    this.db
      .prepare(
        `UPDATE tools SET
           description = CASE WHEN description = '' THEN ? ELSE description END,
           homepage    = COALESCE(homepage, ?),
           category    = CASE WHEN category = 'uncategorized' THEN ? ELSE category END
         WHERE tool_id = ?`,
      )
      .run(tool.description, tool.homepage ?? null, tool.category, tool.tool_id);
    return false;
  }

  getTool(tool_id: string): ToolRecord | null {
    return (this.db.prepare('SELECT * FROM tools WHERE tool_id = ?').get(tool_id) ?? null) as
      | ToolRecord
      | null;
  }

  /** Directory search: name/description/id match + category filter, reviewed tools first. */
  searchTools(params: {
    q?: string;
    category?: string;
    limit?: number;
    offset?: number;
  }): (ToolRecord & { n_outcomes: number })[] {
    const { where, args } = toolFilter(params);
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
    const offset = Math.max(params.offset ?? 0, 0);
    return this.db
      .prepare(
        `SELECT t.*, COALESCE(c.n, 0) AS n_outcomes
         FROM tools t
         LEFT JOIN (SELECT tool_id, COUNT(*) AS n FROM outcomes GROUP BY tool_id) c
           ON c.tool_id = t.tool_id
         ${where}
         ORDER BY n_outcomes DESC, t.name COLLATE NOCASE ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset) as unknown as (ToolRecord & { n_outcomes: number })[];
  }

  countTools(params: { q?: string; category?: string } = {}): number {
    const { where, args } = toolFilter(params);
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM tools t ${where}`)
      .get(...args) as { n: number };
    return row.n;
  }

  /** Tools that share a server prefix (everything before '#') — the "company page" siblings. */
  siblingTools(tool_id: string, limit = 12): (ToolRecord & { n_outcomes: number })[] {
    const prefix = tool_id.split('#')[0];
    return this.db
      .prepare(
        `SELECT t.*, COALESCE(c.n, 0) AS n_outcomes
         FROM tools t
         LEFT JOIN (SELECT tool_id, COUNT(*) AS n FROM outcomes GROUP BY tool_id) c
           ON c.tool_id = t.tool_id
         WHERE (t.tool_id = ? OR t.tool_id LIKE ?) AND t.tool_id != ?
         ORDER BY n_outcomes DESC, t.name COLLATE NOCASE ASC LIMIT ?`,
      )
      .all(prefix, `${prefix}#%`, tool_id, limit) as unknown as (ToolRecord & {
      n_outcomes: number;
    })[];
  }

  /**
   * Global count of verified outcomes per reporter, across all tools — feeds
   * the scoring maturity factor so a swarm of fresh Sybil keys weighs less
   * than an established reporter. One query, cached by the caller per request.
   */
  reporterReputation(): Map<string, number> {
    const rows = this.db
      .prepare('SELECT reporter_id, COUNT(*) AS n FROM outcomes WHERE verified = 1 GROUP BY reporter_id')
      .all() as unknown as { reporter_id: string; n: number }[];
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.reporter_id, r.n);
    return map;
  }

  /** Only tools that actually have outcomes — keeps the leaderboard cheap at catalog scale. */
  ratedToolIds(category?: string): string[] {
    const rows = category
      ? this.db
          .prepare(
            `SELECT DISTINCT o.tool_id FROM outcomes o
             JOIN tools t ON t.tool_id = o.tool_id WHERE t.category = ?`,
          )
          .all(category)
      : this.db.prepare('SELECT DISTINCT tool_id FROM outcomes').all();
    return (rows as { tool_id: string }[]).map((r) => r.tool_id);
  }

  listTools(category?: string): ToolRecord[] {
    if (category) {
      return this.db
        .prepare('SELECT * FROM tools WHERE category = ? ORDER BY tool_id')
        .all(category) as unknown as ToolRecord[];
    }
    return this.db.prepare('SELECT * FROM tools ORDER BY tool_id').all() as unknown as ToolRecord[];
  }

  listCategories(): { category: string; n_tools: number; n_outcomes: number }[] {
    return this.db
      .prepare(
        `SELECT t.category AS category,
                COUNT(DISTINCT t.tool_id) AS n_tools,
                (SELECT COUNT(*) FROM outcomes o WHERE o.category = t.category) AS n_outcomes
         FROM tools t GROUP BY t.category ORDER BY t.category`,
      )
      .all() as unknown as { category: string; n_tools: number; n_outcomes: number }[];
  }

  // ---- reporters ---------------------------------------------------------

  ensureReporter(
    reporter_id: string,
    opts: { public_key?: string | null; label?: string | null; kind?: 'probe' | 'agent' } = {},
  ): void {
    this.db
      .prepare(
        `INSERT INTO reporters (reporter_id, public_key, label, kind, first_seen)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(reporter_id) DO UPDATE SET
           public_key = COALESCE(excluded.public_key, reporters.public_key),
           label = COALESCE(excluded.label, reporters.label)`,
      )
      .run(
        reporter_id,
        opts.public_key ?? null,
        opts.label ?? null,
        opts.kind ?? 'agent',
        new Date().toISOString(),
      );
  }

  getReporter(reporter_id: string): ReporterRecord | null {
    return (this.db.prepare('SELECT * FROM reporters WHERE reporter_id = ?').get(reporter_id) ??
      null) as ReporterRecord | null;
  }

  // ---- outcomes ----------------------------------------------------------

  insertOutcome(outcome: ExecutionOutcome, verified: boolean): void {
    this.db
      .prepare(
        `INSERT INTO outcomes (
           outcome_id, tool_id, reporter_id, ts, received_at, status, failure_mode,
           quality, latency_ms, cost_usd, category, task_kind, verified,
           session_fingerprint, notes
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        outcome.outcome_id,
        outcome.tool_id,
        outcome.reporter_id,
        outcome.ts,
        new Date().toISOString(),
        outcome.status,
        outcome.failure_mode ?? null,
        outcome.quality ?? null,
        outcome.latency_ms,
        outcome.cost_usd ?? null,
        outcome.category,
        outcome.task_kind,
        verified ? 1 : 0,
        outcome.session_fingerprint ?? null,
        outcome.notes ?? null,
      );
  }

  hasOutcome(outcome_id: string): boolean {
    return (
      this.db.prepare('SELECT 1 FROM outcomes WHERE outcome_id = ?').get(outcome_id) !== undefined
    );
  }

  /** Outcomes for one tool, newest first. */
  outcomesForTool(tool_id: string, limit = 5000): StoredOutcome[] {
    return (
      this.db
        .prepare('SELECT * FROM outcomes WHERE tool_id = ? ORDER BY ts DESC LIMIT ?')
        .all(tool_id, limit) as unknown as Record<string, unknown>[]
    ).map(rowToOutcome);
  }

  /** Most recent outcomes across all tools (for the public feed). */
  recentOutcomes(limit = 50, category?: string): StoredOutcome[] {
    const rows = category
      ? this.db
          .prepare(
            'SELECT * FROM outcomes WHERE category = ? ORDER BY received_at DESC, ts DESC LIMIT ?',
          )
          .all(category, limit)
      : this.db
          .prepare('SELECT * FROM outcomes ORDER BY received_at DESC, ts DESC LIMIT ?')
          .all(limit);
    return (rows as unknown as Record<string, unknown>[]).map(rowToOutcome);
  }

  /** How many outcomes a reporter has submitted for a tool since the given ISO time. */
  reporterOutcomeCountSince(reporter_id: string, tool_id: string, sinceIso: string): number {
    const row = this.db
      .prepare(
        'SELECT COUNT(*) AS n FROM outcomes WHERE reporter_id = ? AND tool_id = ? AND received_at >= ?',
      )
      .get(reporter_id, tool_id, sinceIso) as { n: number };
    return row.n;
  }

  reporterTotalSince(reporter_id: string, sinceIso: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM outcomes WHERE reporter_id = ? AND received_at >= ?')
      .get(reporter_id, sinceIso) as { n: number };
    return row.n;
  }

  countOutcomes(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM outcomes').get() as { n: number }).n;
  }
}

function toolFilter(params: { q?: string; category?: string }): {
  where: string;
  args: (string | number)[];
} {
  const clauses: string[] = [];
  const args: (string | number)[] = [];
  if (params.q?.trim()) {
    const like = `%${params.q.trim().replace(/[%_]/g, '')}%`;
    clauses.push('(t.name LIKE ? OR t.description LIKE ? OR t.tool_id LIKE ?)');
    args.push(like, like, like);
  }
  if (params.category) {
    clauses.push('t.category = ?');
    args.push(params.category);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', args };
}

function rowToOutcome(row: Record<string, unknown>): StoredOutcome {
  return {
    outcome_id: row.outcome_id as string,
    tool_id: row.tool_id as string,
    reporter_id: row.reporter_id as string,
    ts: row.ts as string,
    received_at: row.received_at as string,
    status: row.status as StoredOutcome['status'],
    failure_mode: (row.failure_mode ?? undefined) as StoredOutcome['failure_mode'],
    quality: (row.quality ?? undefined) as number | undefined,
    latency_ms: row.latency_ms as number,
    cost_usd: (row.cost_usd ?? undefined) as number | undefined,
    category: row.category as string,
    task_kind: row.task_kind as string,
    verified: Boolean(row.verified),
    session_fingerprint: (row.session_fingerprint ?? undefined) as string | undefined,
    notes: (row.notes ?? undefined) as string | undefined,
  };
}
