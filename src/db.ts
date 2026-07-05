import type { ExecutionOutcome, ReporterRecord, StoredOutcome, ToolRecord } from './types.js';
import { openDriver, type Dialect, type Driver } from './driver.js';

/** REAL in SQLite, DOUBLE PRECISION in Postgres — otherwise identical. */
function schemaFor(dialect: Dialect): string {
  const real = dialect === 'pg' ? 'DOUBLE PRECISION' : 'REAL';
  return `
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
  quality     ${real},
  latency_ms  ${real} NOT NULL,
  cost_usd    ${real},
  category    TEXT NOT NULL,
  task_kind   TEXT NOT NULL,
  verified    INTEGER NOT NULL DEFAULT 0,
  session_fingerprint TEXT,
  notes       TEXT
);
CREATE INDEX IF NOT EXISTS idx_outcomes_tool_ts ON outcomes (tool_id, ts);
CREATE INDEX IF NOT EXISTS idx_outcomes_reporter_ts ON outcomes (reporter_id, ts);
CREATE INDEX IF NOT EXISTS idx_outcomes_received ON outcomes (received_at);
CREATE INDEX IF NOT EXISTS idx_outcomes_category ON outcomes (category);
`;
}

/**
 * Async data layer over a Driver (SQLite or Postgres). Open with `openDb()`,
 * which selects the backend from DATABASE_URL / FILTERLY_DB and creates the
 * schema. Postgres returns COUNT(*) as a bigint string, so count results are
 * coerced with Number().
 */
export class FilterlyDb {
  private constructor(readonly driver: Driver) {}

  static async open(spec?: string): Promise<FilterlyDb> {
    const driver = await openDriver(spec);
    await driver.exec(schemaFor(driver.dialect));
    return new FilterlyDb(driver);
  }

  async close(): Promise<void> {
    await this.driver.close();
  }

  // Dialect helpers: case-insensitive ordering and case-insensitive LIKE.
  private ci(col: string): string {
    return this.driver.dialect === 'pg' ? `LOWER(${col})` : `${col} COLLATE NOCASE`;
  }
  private get likeOp(): string {
    return this.driver.dialect === 'pg' ? 'ILIKE' : 'LIKE';
  }

  // ---- tools -------------------------------------------------------------

  async upsertTool(tool: Omit<ToolRecord, 'first_seen'> & { first_seen?: string }): Promise<void> {
    await this.driver.run(
      `INSERT INTO tools (tool_id, name, category, description, homepage, first_seen)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(tool_id) DO UPDATE SET
         name = excluded.name,
         category = excluded.category,
         description = CASE WHEN excluded.description != '' THEN excluded.description ELSE tools.description END,
         homepage = COALESCE(excluded.homepage, tools.homepage)`,
      [
        tool.tool_id,
        tool.name,
        tool.category,
        tool.description,
        tool.homepage,
        tool.first_seen ?? new Date().toISOString(),
      ],
    );
  }

  /** Register a tool only if unknown (used by ingest auto-registration). */
  async ensureTool(tool_id: string, name: string, category: string): Promise<void> {
    await this.driver.run(
      `INSERT INTO tools (tool_id, name, category, description, homepage, first_seen)
       VALUES (?, ?, ?, '', NULL, ?) ON CONFLICT(tool_id) DO NOTHING`,
      [tool_id, name, category, new Date().toISOString()],
    );
  }

  /**
   * Register a tool from a catalog import: creates the page if new, and only
   * fills in description/homepage/category where they're missing — an import
   * never clobbers a curated record or a category chosen by real reviews.
   * Returns true if a new page was created.
   */
  async registerImportedTool(tool: {
    tool_id: string;
    name: string;
    category: string;
    description: string;
    homepage?: string | null;
  }): Promise<boolean> {
    const existing = await this.getTool(tool.tool_id);
    if (!existing) {
      await this.upsertTool({ ...tool, homepage: tool.homepage ?? null });
      return true;
    }
    await this.driver.run(
      `UPDATE tools SET
         description = CASE WHEN description = '' THEN ? ELSE description END,
         homepage    = COALESCE(homepage, ?),
         category    = CASE WHEN category = 'uncategorized' THEN ? ELSE category END
       WHERE tool_id = ?`,
      [tool.description, tool.homepage ?? null, tool.category, tool.tool_id],
    );
    return false;
  }

  async getTool(tool_id: string): Promise<ToolRecord | null> {
    const rows = await this.driver.all<ToolRecord>('SELECT * FROM tools WHERE tool_id = ?', [tool_id]);
    return rows[0] ?? null;
  }

  /** Directory search: name/description/id match + category filter, reviewed tools first. */
  async searchTools(params: {
    q?: string;
    category?: string;
    limit?: number;
    offset?: number;
  }): Promise<(ToolRecord & { n_outcomes: number })[]> {
    const { where, args } = this.toolFilter(params);
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
    const offset = Math.max(params.offset ?? 0, 0);
    const rows = await this.driver.all<ToolRecord & { n_outcomes: number | string }>(
      `SELECT t.*, COALESCE(c.n, 0) AS n_outcomes
       FROM tools t
       LEFT JOIN (SELECT tool_id, COUNT(*) AS n FROM outcomes GROUP BY tool_id) c
         ON c.tool_id = t.tool_id
       ${where}
       ORDER BY n_outcomes DESC, ${this.ci('t.name')} ASC
       LIMIT ? OFFSET ?`,
      [...args, limit, offset],
    );
    return rows.map((r) => ({ ...r, n_outcomes: Number(r.n_outcomes) }));
  }

  async countTools(params: { q?: string; category?: string } = {}): Promise<number> {
    const { where, args } = this.toolFilter(params);
    const rows = await this.driver.all<{ n: number | string }>(
      `SELECT COUNT(*) AS n FROM tools t ${where}`,
      args,
    );
    return Number(rows[0]?.n ?? 0);
  }

  /** Tools that share a server prefix (everything before '#') — the "company page" siblings. */
  async siblingTools(tool_id: string, limit = 12): Promise<(ToolRecord & { n_outcomes: number })[]> {
    const prefix = tool_id.split('#')[0];
    const rows = await this.driver.all<ToolRecord & { n_outcomes: number | string }>(
      `SELECT t.*, COALESCE(c.n, 0) AS n_outcomes
       FROM tools t
       LEFT JOIN (SELECT tool_id, COUNT(*) AS n FROM outcomes GROUP BY tool_id) c
         ON c.tool_id = t.tool_id
       WHERE (t.tool_id = ? OR t.tool_id ${this.likeOp} ?) AND t.tool_id != ?
       ORDER BY n_outcomes DESC, ${this.ci('t.name')} ASC LIMIT ?`,
      [prefix, `${prefix}#%`, tool_id, limit],
    );
    return rows.map((r) => ({ ...r, n_outcomes: Number(r.n_outcomes) }));
  }

  /**
   * Global count of verified outcomes per reporter, across all tools — feeds
   * the scoring maturity factor so a swarm of fresh Sybil keys weighs less
   * than an established reporter. One query, cached by the caller per request.
   */
  async reporterReputation(): Promise<Map<string, number>> {
    const rows = await this.driver.all<{ reporter_id: string; n: number | string }>(
      'SELECT reporter_id, COUNT(*) AS n FROM outcomes WHERE verified = 1 GROUP BY reporter_id',
    );
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.reporter_id, Number(r.n));
    return map;
  }

  /** Only tools that actually have outcomes — keeps the leaderboard cheap at catalog scale. */
  async ratedToolIds(category?: string): Promise<string[]> {
    const rows = category
      ? await this.driver.all<{ tool_id: string }>(
          `SELECT DISTINCT o.tool_id FROM outcomes o
           JOIN tools t ON t.tool_id = o.tool_id WHERE t.category = ?`,
          [category],
        )
      : await this.driver.all<{ tool_id: string }>('SELECT DISTINCT tool_id FROM outcomes');
    return rows.map((r) => r.tool_id);
  }

  async listTools(category?: string): Promise<ToolRecord[]> {
    return category
      ? this.driver.all<ToolRecord>('SELECT * FROM tools WHERE category = ? ORDER BY tool_id', [
          category,
        ])
      : this.driver.all<ToolRecord>('SELECT * FROM tools ORDER BY tool_id');
  }

  async listCategories(): Promise<{ category: string; n_tools: number; n_outcomes: number }[]> {
    const rows = await this.driver.all<{
      category: string;
      n_tools: number | string;
      n_outcomes: number | string;
    }>(
      `SELECT t.category AS category,
              COUNT(DISTINCT t.tool_id) AS n_tools,
              (SELECT COUNT(*) FROM outcomes o WHERE o.category = t.category) AS n_outcomes
       FROM tools t GROUP BY t.category ORDER BY t.category`,
    );
    return rows.map((r) => ({
      category: r.category,
      n_tools: Number(r.n_tools),
      n_outcomes: Number(r.n_outcomes),
    }));
  }

  // ---- reporters ---------------------------------------------------------

  async ensureReporter(
    reporter_id: string,
    opts: { public_key?: string | null; label?: string | null; kind?: 'probe' | 'agent' } = {},
  ): Promise<void> {
    await this.driver.run(
      `INSERT INTO reporters (reporter_id, public_key, label, kind, first_seen)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(reporter_id) DO UPDATE SET
         public_key = COALESCE(excluded.public_key, reporters.public_key),
         label = COALESCE(excluded.label, reporters.label)`,
      [
        reporter_id,
        opts.public_key ?? null,
        opts.label ?? null,
        opts.kind ?? 'agent',
        new Date().toISOString(),
      ],
    );
  }

  async getReporter(reporter_id: string): Promise<ReporterRecord | null> {
    const rows = await this.driver.all<ReporterRecord>(
      'SELECT * FROM reporters WHERE reporter_id = ?',
      [reporter_id],
    );
    return rows[0] ?? null;
  }

  // ---- outcomes ----------------------------------------------------------

  async insertOutcome(outcome: ExecutionOutcome, verified: boolean): Promise<void> {
    await this.driver.run(
      `INSERT INTO outcomes (
         outcome_id, tool_id, reporter_id, ts, received_at, status, failure_mode,
         quality, latency_ms, cost_usd, category, task_kind, verified,
         session_fingerprint, notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
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
      ],
    );
  }

  async hasOutcome(outcome_id: string): Promise<boolean> {
    const rows = await this.driver.all('SELECT 1 AS one FROM outcomes WHERE outcome_id = ?', [
      outcome_id,
    ]);
    return rows.length > 0;
  }

  /** Outcomes for one tool, newest first. */
  async outcomesForTool(tool_id: string, limit = 5000): Promise<StoredOutcome[]> {
    const rows = await this.driver.all<Record<string, unknown>>(
      'SELECT * FROM outcomes WHERE tool_id = ? ORDER BY ts DESC LIMIT ?',
      [tool_id, limit],
    );
    return rows.map(rowToOutcome);
  }

  /** Most recent outcomes across all tools (for the public feed). */
  async recentOutcomes(limit = 50, category?: string): Promise<StoredOutcome[]> {
    const rows = category
      ? await this.driver.all<Record<string, unknown>>(
          'SELECT * FROM outcomes WHERE category = ? ORDER BY received_at DESC, ts DESC LIMIT ?',
          [category, limit],
        )
      : await this.driver.all<Record<string, unknown>>(
          'SELECT * FROM outcomes ORDER BY received_at DESC, ts DESC LIMIT ?',
          [limit],
        );
    return rows.map(rowToOutcome);
  }

  /** How many outcomes a reporter has submitted for a tool since the given ISO time. */
  async reporterOutcomeCountSince(
    reporter_id: string,
    tool_id: string,
    sinceIso: string,
  ): Promise<number> {
    const rows = await this.driver.all<{ n: number | string }>(
      'SELECT COUNT(*) AS n FROM outcomes WHERE reporter_id = ? AND tool_id = ? AND received_at >= ?',
      [reporter_id, tool_id, sinceIso],
    );
    return Number(rows[0]?.n ?? 0);
  }

  async reporterTotalSince(reporter_id: string, sinceIso: string): Promise<number> {
    const rows = await this.driver.all<{ n: number | string }>(
      'SELECT COUNT(*) AS n FROM outcomes WHERE reporter_id = ? AND received_at >= ?',
      [reporter_id, sinceIso],
    );
    return Number(rows[0]?.n ?? 0);
  }

  async countOutcomes(): Promise<number> {
    const rows = await this.driver.all<{ n: number | string }>(
      'SELECT COUNT(*) AS n FROM outcomes',
    );
    return Number(rows[0]?.n ?? 0);
  }

  async countVerifiedOutcomes(): Promise<number> {
    const rows = await this.driver.all<{ n: number | string }>(
      'SELECT COUNT(*) AS n FROM outcomes WHERE verified = 1',
    );
    return Number(rows[0]?.n ?? 0);
  }

  private toolFilter(params: { q?: string; category?: string }): {
    where: string;
    args: (string | number)[];
  } {
    const clauses: string[] = [];
    const args: (string | number)[] = [];
    if (params.q?.trim()) {
      const like = `%${params.q.trim().replace(/[%_]/g, '')}%`;
      clauses.push(
        `(t.name ${this.likeOp} ? OR t.description ${this.likeOp} ? OR t.tool_id ${this.likeOp} ?)`,
      );
      args.push(like, like, like);
    }
    if (params.category) {
      clauses.push('t.category = ?');
      args.push(params.category);
    }
    return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', args };
  }
}

/** Open the data layer, selecting Postgres (DATABASE_URL) or SQLite by config. */
export function openDb(spec?: string): Promise<FilterlyDb> {
  return FilterlyDb.open(spec);
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
    quality: row.quality == null ? undefined : Number(row.quality),
    latency_ms: Number(row.latency_ms),
    cost_usd: row.cost_usd == null ? undefined : Number(row.cost_usd),
    category: row.category as string,
    task_kind: row.task_kind as string,
    verified: Boolean(row.verified),
    session_fingerprint: (row.session_fingerprint ?? undefined) as string | undefined,
    notes: (row.notes ?? undefined) as string | undefined,
  };
}
