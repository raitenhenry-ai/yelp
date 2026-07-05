/**
 * Demo catalog: a plausible slice of the MCP ecosystem with hand-written
 * reliability profiles. Seeded data is clearly labeled (reporter labels start
 * with "seed-") and exists to demonstrate the product before live probe
 * volume accumulates — replace with real probe output as it grows.
 */
export interface SeedProfile {
  tool_id: string;
  name: string;
  category: string;
  description: string;
  homepage?: string;
  /** Base probability an execution succeeds. */
  reliability: number;
  /** Median latency ms and jitter factor. */
  latency_med_ms: number;
  latency_jitter: number;
  /** Weighted failure modes when it fails. */
  failure_modes: Record<string, number>;
  /** Optional regression: reliability becomes `to` in the last `days_ago` days. */
  drift?: { days_ago: number; to: number };
  /** Typical tasks agents attempt with it. */
  tasks: string[];
  volume: number;
}

export const SEED_CATALOG: SeedProfile[] = [
  // --- web-scraping / data-extraction (the wedge category) ---
  {
    tool_id: 'mcp:demo.fetchwell/scraper',
    name: 'FetchWell Scraper',
    category: 'web-scraping',
    description: 'Headless-browser scraping with auto-retry and readability extraction.',
    reliability: 0.94,
    latency_med_ms: 2600,
    latency_jitter: 0.5,
    failure_modes: { timeout: 3, runtime_error: 1 },
    tasks: ['extract article text from url', 'scrape product listing page', 'render js-heavy page'],
    volume: 46,
  },
  {
    tool_id: 'mcp:demo.pagehound/extract',
    name: 'PageHound Extract',
    category: 'web-scraping',
    description: 'Fast CSS-selector extraction API. No JS rendering.',
    reliability: 0.81,
    latency_med_ms: 900,
    latency_jitter: 0.4,
    failure_modes: { wrong_result: 3, timeout: 1 },
    tasks: ['extract table from html page', 'pull og-meta from url'],
    volume: 38,
  },
  {
    tool_id: 'mcp:demo.spiderling/crawl',
    name: 'Spiderling',
    category: 'web-scraping',
    description: 'Crawler MCP with sitemap discovery. Popular; 4.2k GitHub stars.',
    reliability: 0.95,
    latency_med_ms: 3400,
    latency_jitter: 0.6,
    failure_modes: { timeout: 2, rate_limited: 2 },
    drift: { days_ago: 4, to: 0.12 },
    tasks: ['crawl docs site', 'extract article text from url', 'fetch sitemap'],
    volume: 52,
  },
  {
    tool_id: 'mcp:demo.rustler/readability',
    name: 'Rustler Readability',
    category: 'web-scraping',
    description: 'Rust-based readability extraction. Minimal, fast.',
    reliability: 0.9,
    latency_med_ms: 420,
    latency_jitter: 0.3,
    failure_modes: { wrong_result: 2, runtime_error: 1 },
    tasks: ['extract article text from url'],
    volume: 24,
  },
  // --- search ---
  {
    tool_id: 'mcp:demo.querymule/search',
    name: 'QueryMule Search',
    category: 'search',
    description: 'Meta-search MCP over three engines with deduped results.',
    reliability: 0.92,
    latency_med_ms: 1400,
    latency_jitter: 0.4,
    failure_modes: { rate_limited: 3, timeout: 1 },
    tasks: ['web search for recent news', 'find documentation page'],
    volume: 40,
  },
  {
    tool_id: 'mcp:demo.deepdig/search',
    name: 'DeepDig',
    category: 'search',
    description: 'LLM-reranked web search. Slower, higher quality.',
    reliability: 0.88,
    latency_med_ms: 4200,
    latency_jitter: 0.5,
    failure_modes: { timeout: 3, auth_error: 1 },
    tasks: ['research query with citations', 'web search for recent news'],
    volume: 30,
  },
  // --- payments ---
  {
    tool_id: 'mcp:demo.ledgerline/payments',
    name: 'LedgerLine Payments',
    category: 'payments',
    description: 'Payment intents, refunds, and customer lookups.',
    reliability: 0.97,
    latency_med_ms: 800,
    latency_jitter: 0.25,
    failure_modes: { auth_error: 2, runtime_error: 1 },
    tasks: ['create payment intent', 'issue refund', 'look up customer'],
    volume: 34,
  },
  {
    tool_id: 'mcp:demo.coinchute/pay',
    name: 'CoinChute Pay',
    category: 'payments',
    description: 'Payments MCP with generous free tier. Docs promise a lot.',
    reliability: 0.55,
    latency_med_ms: 2100,
    latency_jitter: 0.8,
    failure_modes: { wrong_result: 3, schema_mismatch: 2, unavailable: 2 },
    tasks: ['create payment intent', 'check balance'],
    volume: 28,
  },
  // --- email / messaging ---
  {
    tool_id: 'mcp:demo.postpigeon/email',
    name: 'PostPigeon Email',
    category: 'messaging',
    description: 'Transactional email sending and inbox search.',
    reliability: 0.93,
    latency_med_ms: 1100,
    latency_jitter: 0.3,
    failure_modes: { rate_limited: 2, auth_error: 1 },
    tasks: ['send transactional email', 'search inbox'],
    volume: 26,
  },
  {
    tool_id: 'mcp:demo.hollercast/notify',
    name: 'HollerCast Notify',
    category: 'messaging',
    description: 'Multi-channel notifications (email, sms, push). Self-hosted.',
    reliability: 0.72,
    latency_med_ms: 1900,
    latency_jitter: 0.6,
    failure_modes: { unavailable: 3, timeout: 2 },
    tasks: ['send push notification', 'send transactional email'],
    volume: 20,
  },
  // --- databases ---
  {
    tool_id: 'mcp:demo.tabularasa/sql',
    name: 'TabulaRasa SQL',
    category: 'databases',
    description: 'Read-only SQL over Postgres with schema introspection.',
    reliability: 0.96,
    latency_med_ms: 350,
    latency_jitter: 0.3,
    failure_modes: { runtime_error: 2 },
    tasks: ['run analytics query', 'introspect schema'],
    volume: 42,
  },
  {
    tool_id: 'mcp:demo.mongoose-loose/nosql',
    name: 'MongooseLoose',
    category: 'databases',
    description: 'Document-store MCP. Ambitious tool list, uneven delivery.',
    reliability: 0.66,
    latency_med_ms: 1500,
    latency_jitter: 0.7,
    failure_modes: { schema_mismatch: 3, wrong_result: 2, timeout: 1 },
    tasks: ['query collection', 'aggregate pipeline'],
    volume: 22,
  },
  // --- code-execution ---
  {
    tool_id: 'mcp:demo.sandboxer/exec',
    name: 'Sandboxer',
    category: 'code-execution',
    description: 'Ephemeral sandboxed python/node execution.',
    reliability: 0.91,
    latency_med_ms: 2800,
    latency_jitter: 0.4,
    failure_modes: { timeout: 3, runtime_error: 2 },
    tasks: ['run python snippet', 'evaluate data transform'],
    volume: 36,
  },
  {
    tool_id: 'mcp:demo.replvolcano/run',
    name: 'ReplVolcano',
    category: 'code-execution',
    description: 'Fast REPL MCP. Recently shipped a big rewrite.',
    reliability: 0.5,
    latency_med_ms: 1200,
    latency_jitter: 0.9,
    failure_modes: { runtime_error: 4, unavailable: 2 },
    drift: { days_ago: 10, to: 0.85 },
    tasks: ['run python snippet', 'run js snippet'],
    volume: 30,
  },
  // --- documents ---
  {
    tool_id: 'mcp:demo.paperclip/docs',
    name: 'PaperClip Docs',
    category: 'documents',
    description: 'PDF/DOCX parsing, chunking, and table extraction.',
    reliability: 0.89,
    latency_med_ms: 3100,
    latency_jitter: 0.5,
    failure_modes: { wrong_result: 2, timeout: 2 },
    tasks: ['extract tables from pdf', 'parse docx to markdown'],
    volume: 32,
  },
  {
    tool_id: 'mcp:demo.inkwell/ocr',
    name: 'Inkwell OCR',
    category: 'documents',
    description: 'OCR for scans and screenshots.',
    reliability: 0.84,
    latency_med_ms: 4600,
    latency_jitter: 0.5,
    failure_modes: { wrong_result: 3, timeout: 1 },
    tasks: ['ocr a screenshot', 'ocr scanned invoice'],
    volume: 18,
  },
  // --- calendars / scheduling ---
  {
    tool_id: 'mcp:demo.chronotool/calendar',
    name: 'ChronoTool Calendar',
    category: 'scheduling',
    description: 'Calendar read/write with timezone handling.',
    reliability: 0.9,
    latency_med_ms: 700,
    latency_jitter: 0.3,
    failure_modes: { auth_error: 2, wrong_result: 1 },
    tasks: ['create event', 'find free slot'],
    volume: 24,
  },
  // --- browser automation ---
  {
    tool_id: 'mcp:demo.marionette/browser',
    name: 'Marionette Browser',
    category: 'browser-automation',
    description: 'Full browser automation: navigate, click, screenshot.',
    reliability: 0.86,
    latency_med_ms: 5200,
    latency_jitter: 0.6,
    failure_modes: { timeout: 4, runtime_error: 2 },
    tasks: ['fill and submit form', 'screenshot page', 'navigate and click'],
    volume: 34,
  },
  {
    tool_id: 'mcp:demo.ghostclick/browser',
    name: 'GhostClick',
    category: 'browser-automation',
    description: 'Lightweight browser automation. 12k GitHub stars, glowing README.',
    reliability: 0.58,
    latency_med_ms: 6800,
    latency_jitter: 0.8,
    failure_modes: { timeout: 4, wrong_result: 2, unavailable: 1 },
    tasks: ['fill and submit form', 'navigate and click'],
    volume: 26,
  },
];
