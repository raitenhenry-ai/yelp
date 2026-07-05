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

  getTool(tool_id: string): ToolRecord | null {
    return (this.db.prepare('SELECT * FROM tools WHERE tool_id = ?').get(tool_id) ?? null) as
      | ToolRecord
      | null;
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
