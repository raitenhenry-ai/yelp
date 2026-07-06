/**
 * Curated real tools for the demo seed. Hand-written so the leaderboard and
 * feed show correct, recognizable names (not machine-guessed ones). Reviews in
 * the seed land only on these; the rest of the catalog is still imported for
 * browsing. Real agent submissions carry their own tool_name, so organic data
 * is correct without any of this.
 *
 * `reliability` (0..1) sets each tool's baseline success rate so the ranking
 * looks believable — well-run services near the top, a few flaky ones lower.
 */
export interface CuratedTool {
  tool_id: string;
  name: string;
  category: string;
  description: string;
  reliability: number;
  latency_med_ms: number;
}

export const CURATED_TOOLS: CuratedTool[] = [
  { tool_id: 'mcp:com.github/github-mcp-server', name: 'GitHub', category: 'devops', description: 'Manage repositories, issues, pull requests, and actions on GitHub.', reliability: 0.97, latency_med_ms: 640 },
  { tool_id: 'mcp:com.stripe/mcp', name: 'Stripe', category: 'payments', description: 'Create payments, refunds, customers, and subscriptions.', reliability: 0.98, latency_med_ms: 720 },
  { tool_id: 'mcp:com.slack/mcp', name: 'Slack', category: 'messaging', description: 'Post messages, read channels, and manage a Slack workspace.', reliability: 0.95, latency_med_ms: 520 },
  { tool_id: 'mcp:com.notion/mcp', name: 'Notion', category: 'productivity', description: 'Read and write Notion pages, databases, and blocks.', reliability: 0.9, latency_med_ms: 1100 },
  { tool_id: 'mcp:app.linear/mcp', name: 'Linear', category: 'productivity', description: 'Create and update Linear issues, projects, and cycles.', reliability: 0.94, latency_med_ms: 480 },
  { tool_id: 'mcp:io.github.microsoft/playwright-mcp', name: 'Playwright', category: 'browser-automation', description: 'Drive a real browser: navigate, click, fill forms, screenshot.', reliability: 0.9, latency_med_ms: 3200 },
  { tool_id: 'mcp:com.cloudflare/mcp', name: 'Cloudflare', category: 'devops', description: 'Manage Workers, DNS, KV, R2, and Cloudflare account resources.', reliability: 0.93, latency_med_ms: 700 },
  { tool_id: 'mcp:com.supabase/mcp', name: 'Supabase', category: 'databases', description: 'Query Postgres, manage tables, auth, and storage on Supabase.', reliability: 0.92, latency_med_ms: 650 },
  { tool_id: 'mcp:tech.neon/mcp', name: 'Neon', category: 'databases', description: 'Provision and query serverless Postgres branches on Neon.', reliability: 0.94, latency_med_ms: 420 },
  { tool_id: 'mcp:ai.perplexity/mcp', name: 'Perplexity', category: 'search', description: 'Answer questions with cited, up-to-date web search.', reliability: 0.91, latency_med_ms: 3800 },
  { tool_id: 'mcp:dev.firecrawl/mcp', name: 'Firecrawl', category: 'web-scraping', description: 'Crawl and scrape sites into clean markdown, with JS rendering.', reliability: 0.88, latency_med_ms: 2900 },
  { tool_id: 'mcp:ai.exa/mcp', name: 'Exa', category: 'search', description: 'Neural web search built for retrieval, with full-text contents.', reliability: 0.9, latency_med_ms: 1500 },
  { tool_id: 'mcp:com.tavily/mcp', name: 'Tavily', category: 'search', description: 'Search API tuned for LLM agents with sourced snippets.', reliability: 0.89, latency_med_ms: 1400 },
  { tool_id: 'mcp:com.brave/search-mcp', name: 'Brave Search', category: 'search', description: 'Independent web and news search via the Brave Search API.', reliability: 0.9, latency_med_ms: 900 },
  { tool_id: 'mcp:com.browserbase/mcp', name: 'Browserbase', category: 'browser-automation', description: 'Run headless browsers in the cloud for automation and scraping.', reliability: 0.85, latency_med_ms: 4200 },
  { tool_id: 'mcp:com.apify/mcp', name: 'Apify', category: 'web-scraping', description: 'Run scraping and automation actors from the Apify store.', reliability: 0.83, latency_med_ms: 5200 },
  { tool_id: 'mcp:dev.e2b/mcp', name: 'E2B', category: 'code-execution', description: 'Run code in secure, ephemeral cloud sandboxes.', reliability: 0.9, latency_med_ms: 2600 },
  { tool_id: 'mcp:com.figma/mcp', name: 'Figma', category: 'productivity', description: 'Read Figma files, frames, and design tokens.', reliability: 0.87, latency_med_ms: 1300 },
  { tool_id: 'mcp:com.twilio/mcp', name: 'Twilio', category: 'messaging', description: 'Send SMS and WhatsApp messages and place calls.', reliability: 0.95, latency_med_ms: 780 },
  { tool_id: 'mcp:com.resend/mcp', name: 'Resend', category: 'messaging', description: 'Send transactional email with a simple API.', reliability: 0.96, latency_med_ms: 540 },
  { tool_id: 'mcp:com.sendgrid/mcp', name: 'SendGrid', category: 'messaging', description: 'Transactional and marketing email delivery.', reliability: 0.9, latency_med_ms: 950 },
  { tool_id: 'mcp:com.airtable/mcp', name: 'Airtable', category: 'databases', description: 'Read and write Airtable bases, tables, and records.', reliability: 0.89, latency_med_ms: 820 },
  { tool_id: 'mcp:com.hubspot/mcp', name: 'HubSpot', category: 'productivity', description: 'Manage CRM contacts, deals, and companies in HubSpot.', reliability: 0.86, latency_med_ms: 1200 },
  { tool_id: 'mcp:com.atlassian/jira-mcp', name: 'Jira', category: 'productivity', description: 'Create, search, and transition Jira issues.', reliability: 0.82, latency_med_ms: 1600 },
  { tool_id: 'mcp:com.atlassian/confluence-mcp', name: 'Confluence', category: 'documents', description: 'Read and write Confluence pages and spaces.', reliability: 0.8, latency_med_ms: 1700 },
  { tool_id: 'mcp:io.postgresql/mcp', name: 'PostgreSQL', category: 'databases', description: 'Run read-only SQL and inspect schemas on Postgres.', reliability: 0.97, latency_med_ms: 300 },
  { tool_id: 'mcp:com.mongodb/mcp', name: 'MongoDB', category: 'databases', description: 'Query collections and run aggregations on MongoDB.', reliability: 0.88, latency_med_ms: 560 },
  { tool_id: 'mcp:io.redis/mcp', name: 'Redis', category: 'databases', description: 'Read and write keys, lists, and streams on Redis.', reliability: 0.95, latency_med_ms: 180 },
  { tool_id: 'mcp:com.snowflake/mcp', name: 'Snowflake', category: 'data-analytics', description: 'Query the Snowflake data warehouse with SQL.', reliability: 0.91, latency_med_ms: 2200 },
  { tool_id: 'mcp:com.clickhouse/mcp', name: 'ClickHouse', category: 'data-analytics', description: 'Fast analytical SQL over ClickHouse.', reliability: 0.93, latency_med_ms: 480 },
  { tool_id: 'mcp:co.elastic/elasticsearch-mcp', name: 'Elasticsearch', category: 'search', description: 'Full-text and vector search over Elasticsearch indices.', reliability: 0.87, latency_med_ms: 700 },
  { tool_id: 'mcp:com.grafana/mcp', name: 'Grafana', category: 'devops', description: 'Query dashboards, panels, and metrics in Grafana.', reliability: 0.85, latency_med_ms: 900 },
  { tool_id: 'mcp:io.sentry/mcp', name: 'Sentry', category: 'devops', description: 'Fetch and triage error events and issues from Sentry.', reliability: 0.9, latency_med_ms: 760 },
  { tool_id: 'mcp:io.kubernetes/mcp', name: 'Kubernetes', category: 'devops', description: 'Inspect and manage pods, deployments, and services.', reliability: 0.84, latency_med_ms: 1100 },
  { tool_id: 'mcp:com.docker/mcp', name: 'Docker', category: 'devops', description: 'Manage containers, images, and volumes.', reliability: 0.89, latency_med_ms: 620 },
  { tool_id: 'mcp:com.vercel/mcp', name: 'Vercel', category: 'devops', description: 'Manage Vercel projects, deployments, and domains.', reliability: 0.92, latency_med_ms: 680 },
  { tool_id: 'mcp:com.google/maps-mcp', name: 'Google Maps', category: 'geo', description: 'Geocode, search places, and get directions.', reliability: 0.96, latency_med_ms: 420 },
  { tool_id: 'mcp:com.google/calendar-mcp', name: 'Google Calendar', category: 'scheduling', description: 'Read and create calendar events with timezone handling.', reliability: 0.93, latency_med_ms: 620 },
  { tool_id: 'mcp:com.google/gmail-mcp', name: 'Gmail', category: 'messaging', description: 'Search, read, and send email from Gmail.', reliability: 0.9, latency_med_ms: 780 },
  { tool_id: 'mcp:com.openai/mcp', name: 'OpenAI', category: 'ai-models', description: 'Call OpenAI models for text, images, and embeddings.', reliability: 0.94, latency_med_ms: 2400 },
  { tool_id: 'mcp:com.anthropic/mcp', name: 'Anthropic', category: 'ai-models', description: 'Call Claude models for text and tool use.', reliability: 0.95, latency_med_ms: 2100 },
  { tool_id: 'mcp:co.huggingface/mcp', name: 'Hugging Face', category: 'ai-models', description: 'Run inference on Hugging Face models and datasets.', reliability: 0.83, latency_med_ms: 3400 },
  { tool_id: 'mcp:io.pinecone/mcp', name: 'Pinecone', category: 'memory', description: 'Upsert and query vectors in the Pinecone vector database.', reliability: 0.92, latency_med_ms: 380 },
  { tool_id: 'mcp:io.qdrant/mcp', name: 'Qdrant', category: 'memory', description: 'Vector search and payload filtering on Qdrant.', reliability: 0.9, latency_med_ms: 340 },
  { tool_id: 'mcp:tech.weaviate/mcp', name: 'Weaviate', category: 'memory', description: 'Hybrid vector + keyword search on Weaviate.', reliability: 0.86, latency_med_ms: 520 },
  { tool_id: 'mcp:com.wolframalpha/mcp', name: 'Wolfram Alpha', category: 'reasoning', description: 'Computational answers to math, science, and data queries.', reliability: 0.88, latency_med_ms: 1500 },
  { tool_id: 'mcp:org.arxiv/mcp', name: 'arXiv', category: 'search', description: 'Search and fetch scientific papers from arXiv.', reliability: 0.91, latency_med_ms: 900 },
  { tool_id: 'mcp:org.wikipedia/mcp', name: 'Wikipedia', category: 'search', description: 'Search and read Wikipedia articles.', reliability: 0.95, latency_med_ms: 600 },
  { tool_id: 'mcp:com.reddit/mcp', name: 'Reddit', category: 'social', description: 'Read subreddits, posts, and comments.', reliability: 0.82, latency_med_ms: 1000 },
  { tool_id: 'mcp:com.spotify/mcp', name: 'Spotify', category: 'media', description: 'Search tracks and control Spotify playback.', reliability: 0.85, latency_med_ms: 700 },
  { tool_id: 'mcp:com.youtube/mcp', name: 'YouTube', category: 'media', description: 'Search videos and fetch transcripts and metadata.', reliability: 0.8, latency_med_ms: 1300 },
  { tool_id: 'mcp:com.discord/mcp', name: 'Discord', category: 'messaging', description: 'Read and send messages in Discord servers.', reliability: 0.84, latency_med_ms: 620 },
  { tool_id: 'mcp:org.telegram/mcp', name: 'Telegram', category: 'messaging', description: 'Send and receive messages via a Telegram bot.', reliability: 0.86, latency_med_ms: 560 },
  { tool_id: 'mcp:md.obsidian/mcp', name: 'Obsidian', category: 'documents', description: 'Read and write notes in an Obsidian vault.', reliability: 0.88, latency_med_ms: 260 },
  { tool_id: 'mcp:com.todoist/mcp', name: 'Todoist', category: 'productivity', description: 'Create and manage tasks and projects.', reliability: 0.9, latency_med_ms: 480 },
  { tool_id: 'mcp:io.modelcontextprotocol/filesystem', name: 'Filesystem', category: 'filesystem', description: 'Read, write, and search files under allowed roots.', reliability: 0.98, latency_med_ms: 40 },
  { tool_id: 'mcp:io.modelcontextprotocol/memory', name: 'Memory', category: 'memory', description: 'A knowledge-graph memory of entities and relations.', reliability: 0.96, latency_med_ms: 30 },
  { tool_id: 'mcp:io.modelcontextprotocol/sequential-thinking', name: 'Sequential Thinking', category: 'reasoning', description: 'A structured step-by-step reasoning scratchpad.', reliability: 0.97, latency_med_ms: 25 },
  { tool_id: 'mcp:io.modelcontextprotocol/fetch', name: 'Fetch', category: 'web-scraping', description: 'Fetch a URL and convert it to markdown for the model.', reliability: 0.9, latency_med_ms: 900 },
  { tool_id: 'mcp:com.wolfi/time-mcp', name: 'Time', category: 'productivity', description: 'Current time and timezone conversions.', reliability: 0.99, latency_med_ms: 20 },
  { tool_id: 'mcp:com.puppeteer/mcp', name: 'Puppeteer', category: 'browser-automation', description: 'Headless Chrome automation and screenshots.', reliability: 0.82, latency_med_ms: 3600 },
];
