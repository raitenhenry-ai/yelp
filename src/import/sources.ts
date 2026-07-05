import type { FilterlyDb } from '../db.js';
import { categorizeText } from '../catalog.js';

/**
 * Catalog importers: pull "literally every piece of software" agents might
 * use into the directory as pages, so reviews land somewhere named — and so
 * unrated tools are still discoverable with an honest "no evidence yet".
 *
 * Two sources today, one interface, add more as the ecosystem grows:
 *   - the official MCP registry (registry.modelcontextprotocol.io)
 *   - npm packages keyword-tagged as MCP servers
 *
 * Imports are additive-only: a page is created if missing, and only empty
 * fields are filled on existing pages (see db.registerImportedTool). And
 * imports are never *required* — reviewing an unknown tool_id auto-creates
 * its page at ingest time regardless.
 */
export interface ImportStats {
  seen: number;
  created: number;
  updated: number;
}

export interface ImportOptions {
  max?: number;
  log?: (msg: string) => void;
  fetchFn?: typeof fetch;
  baseUrl?: string;
}

/** Fetch with polite backoff on 429/5xx — registries throttle bulk readers. */
async function fetchWithRetry(
  fetchFn: typeof fetch,
  url: string | URL,
  log: (msg: string) => void,
  retries = 4,
): Promise<Response> {
  let delay = 5_000;
  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(url).catch((err) => {
      if (attempt >= retries) throw err;
      return null;
    });
    if (res && res.status !== 429 && res.status < 500) return res;
    if (attempt >= retries) return res ?? fetch(url);
    log(`  throttled (${res?.status ?? 'network error'}) — backing off ${delay / 1000}s`);
    await new Promise((r) => setTimeout(r, delay));
    delay *= 2;
  }
}

interface RegistryEntry {
  server?: {
    name?: string;
    title?: string;
    description?: string;
    repository?: { url?: string };
    websiteUrl?: string;
  };
  _meta?: Record<string, { isLatest?: boolean; status?: string } | undefined>;
}

/** Official MCP registry: cursor-paginated, versioned — keep latest active only. */
export async function importMcpRegistry(
  db: FilterlyDb,
  opts: ImportOptions = {},
): Promise<ImportStats> {
  // The registry paginates over VERSIONS, not servers — a full sweep sees
  // several entries per server, so the cap is intentionally high.
  const max = opts.max ?? 200_000;
  const log = opts.log ?? (() => {});
  const fetchFn = opts.fetchFn ?? fetch;
  const base = opts.baseUrl ?? 'https://registry.modelcontextprotocol.io';
  const stats: ImportStats = { seen: 0, created: 0, updated: 0 };

  let cursor: string | undefined;
  while (stats.seen < max) {
    const url = new URL('/v0/servers', base);
    url.searchParams.set('limit', String(Math.min(100, max - stats.seen)));
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetchWithRetry(fetchFn, url, log);
    if (!res.ok) throw new Error(`registry responded ${res.status}`);
    const body = (await res.json()) as {
      servers: RegistryEntry[];
      metadata?: { nextCursor?: string };
    };

    const batch: Parameters<typeof db.bulkUpsertImportedTools>[0] = [];
    for (const entry of body.servers ?? []) {
      stats.seen++;
      const server = entry.server ?? (entry as RegistryEntry['server']);
      if (!server?.name) continue;
      const official = entry._meta?.['io.modelcontextprotocol.registry/official'];
      if (official && (official.isLatest === false || official.status === 'deleted')) continue;

      const description = (server.description ?? '').slice(0, 500);
      // Categorize on the short name only — registry names are namespaced
      // like "io.github.owner/repo", and the namespace would otherwise drag
      // every tool into the github/devops bucket.
      const shortName = server.name.split('/').pop() ?? server.name;
      batch.push({
        tool_id: `mcp:${server.name}`,
        name: server.title || server.name,
        category: categorizeText(`${shortName} ${server.title ?? ''} ${description}`),
        description,
        homepage: server.websiteUrl ?? server.repository?.url ?? null,
      });
    }
    const upserted = await db.bulkUpsertImportedTools(batch);
    stats.created += upserted.created;
    stats.updated += upserted.updated;

    cursor = body.metadata?.nextCursor;
    if (!cursor || (body.servers ?? []).length === 0) break;
    log(`  …${stats.seen} entries (${stats.created} new pages)`);
  }
  return stats;
}

interface NpmSearchObject {
  package?: {
    name?: string;
    description?: string;
    links?: { homepage?: string; repository?: string; npm?: string };
  };
}

/** npm sweep: everything keyword-tagged mcp / mcp-server. */
export async function importNpm(db: FilterlyDb, opts: ImportOptions = {}): Promise<ImportStats> {
  const max = opts.max ?? 5_000;
  const log = opts.log ?? (() => {});
  const fetchFn = opts.fetchFn ?? fetch;
  const base = opts.baseUrl ?? 'https://registry.npmjs.org';
  const stats: ImportStats = { seen: 0, created: 0, updated: 0 };

  let from = 0;
  while (stats.seen < max) {
    const size = Math.min(250, max - stats.seen);
    const res = await fetchWithRetry(
      fetchFn,
      `${base}/-/v1/search?text=keywords:mcp-server&size=${size}&from=${from}`,
      log,
    );
    if (!res.ok) throw new Error(`npm search responded ${res.status}`);
    const body = (await res.json()) as { objects?: NpmSearchObject[]; total?: number };
    const objects = body.objects ?? [];
    if (objects.length === 0) break;

    const batch: Parameters<typeof db.bulkUpsertImportedTools>[0] = [];
    for (const obj of objects) {
      stats.seen++;
      const pkg = obj.package;
      if (!pkg?.name) continue;
      const description = (pkg.description ?? '').slice(0, 500);
      batch.push({
        tool_id: `mcp:npm/${pkg.name}`,
        name: pkg.name,
        category: categorizeText(`${pkg.name} ${description}`),
        description,
        homepage: pkg.links?.homepage ?? pkg.links?.repository ?? pkg.links?.npm ?? null,
      });
    }
    const upserted = await db.bulkUpsertImportedTools(batch);
    stats.created += upserted.created;
    stats.updated += upserted.updated;

    from += objects.length;
    log(`  …${stats.seen} packages (${stats.created} new pages)`);
    if (body.total !== undefined && from >= body.total) break;
  }
  return stats;
}

export const IMPORT_SOURCES: Record<
  string,
  (db: FilterlyDb, opts: ImportOptions) => Promise<ImportStats>
> = {
  'mcp-registry': importMcpRegistry,
  npm: importNpm,
};
