import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Storage driver abstraction. One async interface, two backends:
 *   - SQLite (node:sqlite) for local dev and tests — synchronous under the hood,
 *     wrapped in resolved promises.
 *   - Postgres (pg) for hosted deployments (Neon, Railway Postgres, RDS…).
 *
 * SQL is authored once with `?` placeholders and neutral syntax; the small
 * dialect differences (placeholder style, case-insensitive ordering, LIKE vs
 * ILIKE) are handled via the driver's `dialect` and the `ci`/`likeOp` helpers
 * on ToolProofDb.
 */
export type Dialect = 'sqlite' | 'pg';

export interface Driver {
  readonly dialect: Dialect;
  /** Run a query and return rows. */
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Run a write; result rows are ignored. */
  run(sql: string, params?: unknown[]): Promise<void>;
  /** Execute one or more DDL statements (no params). */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

// --------------------------------------------------------------------------
// SQLite
// --------------------------------------------------------------------------

export class SqliteDriver implements Driver {
  readonly dialect = 'sqlite' as const;
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path) || '.', { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
  }

  async all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as never[])) as unknown as T[];
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...(params as never[]));
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

// --------------------------------------------------------------------------
// Postgres
// --------------------------------------------------------------------------

/** Translate `?` placeholders to Postgres `$1, $2, …`. Our SQL never contains a
 * literal `?`, so a straight positional replacement is safe. */
export function toPgPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/**
 * Decide the SSL setting for a connection string. Managed Postgres (Neon,
 * Railway, most cloud providers) requires TLS; their certs chain to public
 * roots but some environments lack the intermediate, so we enable TLS and
 * don't hard-fail on an unverifiable chain unless PGSSL_STRICT=1. Plain local
 * connections (localhost/127.0.0.1, no sslmode) use no TLS.
 */
export function sslForConnectionString(url: string): false | { rejectUnauthorized: boolean } {
  const lower = url.toLowerCase();
  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(lower);
  const wantsSsl =
    /sslmode=(require|verify-ca|verify-full)/.test(lower) ||
    /\.neon\.tech/.test(lower) ||
    (!isLocal && !/sslmode=disable/.test(lower));
  if (!wantsSsl) return false;
  return { rejectUnauthorized: process.env.PGSSL_STRICT === '1' };
}

export class PgDriver implements Driver {
  readonly dialect = 'pg' as const;
  // Lazily typed to avoid a hard import when pg isn't installed in a
  // sqlite-only environment; the constructor requires it.
  private readonly pool: import('pg').Pool;

  constructor(pool: import('pg').Pool) {
    this.pool = pool;
  }

  static async connect(connectionString: string): Promise<PgDriver> {
    const { Pool } = await import('pg');
    const pool = new Pool({
      connectionString,
      ssl: sslForConnectionString(connectionString),
      max: Number.parseInt(process.env.PGPOOL_MAX ?? '10', 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    return new PgDriver(pool);
  }

  async all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pool.query(toPgPlaceholders(sql), params as unknown[]);
    return res.rows as T[];
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    await this.pool.query(toPgPlaceholders(sql), params as unknown[]);
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Open the driver selected by configuration: Postgres when DATABASE_URL is set
 * (Neon/Railway), otherwise SQLite at the given path. Explicit `spec` overrides
 * env — pass a `postgres://`/`postgresql://` URL for pg, or a file path /
 * `:memory:` for sqlite.
 */
export async function openDriver(spec?: string): Promise<Driver> {
  const target = spec ?? process.env.DATABASE_URL ?? process.env.TOOLPROOF_DB ?? 'toolproof.db';
  if (/^postgres(ql)?:\/\//i.test(target)) {
    return PgDriver.connect(target);
  }
  return new SqliteDriver(target);
}
