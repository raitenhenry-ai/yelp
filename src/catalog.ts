/**
 * Keyword auto-categorizer for imported tools. Imports arrive with nothing
 * but a name and a description, so pages need a best-effort category that
 * real reviews can later refine (review categories win at scoring time, and
 * an import never overwrites a non-default category — see db.registerImportedTool).
 */
const CATEGORY_KEYWORDS: [string, RegExp][] = [
  ['web-scraping', /\b(scrap|crawl|extract|readability|parse html|web content|firecrawl)/i],
  ['browser-automation', /\b(browser|playwright|puppeteer|selenium|screenshot|headless|click|dom)\b/i],
  ['search', /\b(search|serp|google|bing|duckduckgo|brave search|retriev|lookup)\b/i],
  ['databases', /\b(sql|postgres|mysql|sqlite|mongo|redis|database|db\b|supabase|clickhouse|snowflake|bigquery|duckdb)/i],
  ['payments', /\b(payment|stripe|paypal|checkout|billing|invoice|refund)\b/i],
  ['finance', /\b(stock|crypto(?!graph)|trading|market data|forex|portfolio|banking|ledger)\b/i],
  ['blockchain', /\b(blockchain|ethereum|solana|web3|smart contract|on-?chain|wallet)\b/i],
  ['messaging', /\b(email|slack|discord|telegram|sms|whatsapp|notification|inbox|mail)\b/i],
  ['social', /\b(twitter|reddit|linkedin|mastodon|bluesky|instagram|social)\b/i],
  ['filesystem', /\b(file ?system|files\b|directory|storage|s3|bucket|drive|dropbox)\b/i],
  ['code-execution', /\b(execut|sandbox|repl|run code|interpreter|compile)\b/i],
  ['devops', /\b(kubernetes|k8s|docker|terraform|aws|gcp|azure|ci\/cd|deploy|github|gitlab|jenkins|grafana|prometheus|sentry|pagerduty)\b/i],
  ['security', /\b(security|vulnerabilit|cve|pentest|scan|secret|auth[on]|oauth)\b/i],
  ['documents', /\b(pdf|docx|document|ocr|markdown convert|spreadsheet|excel|csv)\b/i],
  ['memory', /\b(memory|knowledge graph|vector|embedding|rag\b|recall)\b/i],
  ['ai-models', /\b(llm|image gen|diffusion|whisper|speech|transcri|text-to-|inference|model)\b/i],
  ['data-analytics', /\b(analytics|metrics|dashboard|visualiz|statistics|etl|pipeline)\b/i],
  ['geo', /\b(map|geocod|location|weather|gps|route)\b/i],
  ['translation', /\b(translat|language detect|localiz)/i],
  ['media', /\b(video|audio|music|image edit|ffmpeg|spotify|youtube)\b/i],
  ['scheduling', /\b(calendar|schedul|meeting|appointment|reminder|cron)\b/i],
  ['productivity', /\b(notion|jira|linear|asana|trello|todo|task manage|airtable|sheets)\b/i],
  ['reasoning', /\b(reasoning|thinking|chain of thought|planner)\b/i],
];

export function categorizeText(text: string): string {
  for (const [category, pattern] of CATEGORY_KEYWORDS) {
    if (pattern.test(text)) return category;
  }
  return 'uncategorized';
}
