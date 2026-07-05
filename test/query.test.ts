import { describe, expect, it } from 'vitest';
import { ingestOutcome } from '../src/ingest.js';
import { getFeed, getToolReport, getToolReviews } from '../src/query.js';
import { daysAgo, memDb, outcome } from './helpers.js';
import type { ToolProofDb } from '../src/db.js';

async function seedTwoScrapers(): Promise<ToolProofDb> {
  const db = await memDb();
  await db.upsertTool({
    tool_id: 'mcp:good/scraper',
    name: 'Good Scraper',
    category: 'web-scraping',
    description: 'Reliable page extraction',
    homepage: null,
  });
  await db.upsertTool({
    tool_id: 'mcp:bad/scraper',
    name: 'Bad Scraper',
    category: 'web-scraping',
    description: 'Ambitious page extraction',
    homepage: null,
  });
  for (let i = 0; i < 12; i++) {
    await ingestOutcome(db, {
      outcome: outcome({
        tool_id: 'mcp:good/scraper',
        tool_name: 'Good Scraper',
        category: 'web-scraping',
        task_kind: 'extract article text from url',
        ts: daysAgo(i % 5),
        reporter_id: `rep-${i % 3}`.padEnd(8, '0'),
      }),
    });
    await ingestOutcome(db, {
      outcome: outcome({
        tool_id: 'mcp:bad/scraper',
        tool_name: 'Bad Scraper',
        category: 'web-scraping',
        task_kind: 'extract article text from url',
        status: i % 3 === 0 ? 'success' : 'failure',
        failure_mode: i % 3 === 0 ? undefined : 'timeout',
        ts: daysAgo(i % 5),
        reporter_id: `rep-${i % 3}`.padEnd(8, '0'),
      }),
    });
  }
  return db;
}

describe('getToolReviews', () => {
  it('ranks the reliable tool above the flaky one for a capability query', async () => {
    const db = await seedTwoScrapers();
    const results = await getToolReviews(db, { capability: 'extract text from a web page' });
    expect(results.length).toBe(2);
    expect(results[0].tool_id).toBe('mcp:good/scraper');
    expect(results[0].score).toBeGreaterThan(results[1].score);
    expect(results[0].summary).toContain('★');
    expect(results[0].recent_reviews.length).toBeGreaterThan(0);
  });

  it('filters out non-matching capabilities', async () => {
    const db = await seedTwoScrapers();
    const results = await getToolReviews(db, { capability: 'send a payment refund' });
    expect(results.length).toBe(0);
  });

  it('filters by category', async () => {
    const db = await seedTwoScrapers();
    expect((await getToolReviews(db, { category: 'web-scraping' })).length).toBe(2);
    expect((await getToolReviews(db, { category: 'payments' })).length).toBe(0);
  });
});

describe('getToolReport', () => {
  it('returns a full report with outcome samples', async () => {
    const db = await seedTwoScrapers();
    const report = await getToolReport(db, 'mcp:bad/scraper');
    expect(report).not.toBeNull();
    expect(report!.top_failure_mode).toBe('timeout');
    expect(report!.outcomes_sample.length).toBeGreaterThan(0);
    expect(report!.n_outcomes).toBe(12);
  });

  it('returns null for unknown tools', async () => {
    const db = await seedTwoScrapers();
    expect(await getToolReport(db, 'mcp:nope/nothing')).toBeNull();
  });
});

describe('getFeed', () => {
  it('renders recent outcomes as review blurbs with stars', async () => {
    const db = await seedTwoScrapers();
    const feed = await getFeed(db, 10);
    expect(feed.length).toBe(10);
    for (const item of feed) {
      expect(item.blurb.length).toBeGreaterThan(5);
      expect(item.stars).toBeGreaterThanOrEqual(1);
      expect(item.stars).toBeLessThanOrEqual(5);
    }
  });

  it('appends agent notes to the blurb', async () => {
    const db = await memDb();
    await ingestOutcome(db, {
      outcome: outcome({
        status: 'failure',
        failure_mode: 'wrong_result',
        notes: 'returned yesterday\'s data as today\'s',
      }),
    });
    const feed = await getFeed(db, 1);
    expect(feed[0].blurb).toContain("returned yesterday's data as today's");
  });
});
