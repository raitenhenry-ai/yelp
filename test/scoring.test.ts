import { describe, expect, it } from 'vitest';
import { scoreTool, starsFromScore } from '../src/scoring.js';
import type { StoredOutcome, ToolRecord } from '../src/types.js';
import { daysAgo, outcome } from './helpers.js';

const tool: ToolRecord = {
  tool_id: 'mcp:test/tool',
  name: 'Test Tool',
  category: 'testing',
  description: '',
  homepage: null,
  first_seen: daysAgo(60),
};

function stored(
  overrides: Partial<StoredOutcome> = {},
): StoredOutcome {
  return { ...outcome(), verified: true, received_at: new Date().toISOString(), ...overrides };
}

describe('scoreTool', () => {
  it('gives the neutral prior with no outcomes', () => {
    const s = scoreTool(tool, []);
    expect(s.score).toBe(0.5);
    expect(s.confidence).toBe(0);
    expect(s.rank_score).toBe(0.5);
    expect(s.trend).toBe('insufficient');
  });

  it('scores all-success high and all-failure low', () => {
    const good = scoreTool(tool, Array.from({ length: 20 }, () => stored({ ts: daysAgo(1) })));
    const bad = scoreTool(
      tool,
      Array.from({ length: 20 }, () =>
        stored({ status: 'failure', failure_mode: 'timeout', ts: daysAgo(1) }),
      ),
    );
    expect(good.score).toBeGreaterThan(0.9);
    expect(bad.score).toBeLessThan(0.1);
    expect(good.stars).toBeGreaterThanOrEqual(4.5);
    expect(bad.stars).toBeLessThanOrEqual(1.5);
  });

  it('recency: fresh failures outweigh stale successes', () => {
    const outcomes = [
      // 25 successes six weeks ago (3 half-lives → weight ~0.125 each)
      ...Array.from({ length: 25 }, () => stored({ ts: daysAgo(42) })),
      // 10 failures this week
      ...Array.from({ length: 10 }, (_, i) =>
        stored({ status: 'failure' as const, failure_mode: 'unavailable' as const, ts: daysAgo(i % 3) }),
      ),
    ];
    const s = scoreTool(tool, outcomes);
    expect(s.score).toBeLessThan(0.5);
  });

  it('verification: unverified reports carry a fraction of the weight', () => {
    const verifiedFailures = Array.from({ length: 5 }, () =>
      stored({ status: 'failure' as const, failure_mode: 'timeout' as const, ts: daysAgo(1), reporter_id: 'r1' }),
    );
    const unverifiedPraise = Array.from({ length: 5 }, () =>
      stored({ verified: false, ts: daysAgo(1), reporter_id: 'r2' }),
    );
    const s = scoreTool(tool, [...verifiedFailures, ...unverifiedPraise]);
    // 5 verified failures should dominate 5 unverified successes
    expect(s.score).toBeLessThan(0.4);
  });

  it('caps a single reporter\'s share so one shill cannot outvote the crowd', () => {
    const crowd = Array.from({ length: 6 }, (_, i) =>
      stored({ status: 'failure' as const, failure_mode: 'wrong_result' as const, ts: daysAgo(1), reporter_id: `crowd-${i}` }),
    );
    const shill = Array.from({ length: 60 }, () =>
      stored({ ts: daysAgo(1), reporter_id: 'vendor-shill' }),
    );
    const s = scoreTool(tool, [...crowd, ...shill]);
    // Without the cap the shill's 60 successes would push the score >0.85;
    // with a 40% share cap the crowd's failures keep it near the middle.
    expect(s.score).toBeLessThan(0.65);
  });

  it('detects a decline when a tool breaks this week', () => {
    const outcomes = [
      ...Array.from({ length: 15 }, (_, i) => stored({ ts: daysAgo(8 + (i % 18)) })),
      ...Array.from({ length: 6 }, (_, i) =>
        stored({ status: 'failure' as const, failure_mode: 'runtime_error' as const, ts: daysAgo(i % 6) }),
      ),
    ];
    const s = scoreTool(tool, outcomes);
    expect(s.trend).toBe('declining');
    expect(s.top_failure_mode).toBe('runtime_error');
  });

  it('confidence grows with evidence', () => {
    const few = scoreTool(tool, [stored({ ts: daysAgo(0) })]);
    const many = scoreTool(tool, Array.from({ length: 30 }, () => stored({ ts: daysAgo(0) })));
    expect(many.confidence).toBeGreaterThan(few.confidence);
    expect(few.rank_score).toBeLessThan(many.rank_score); // same success rate, more evidence ranks higher
  });
});

describe('starsFromScore', () => {
  it('maps 0..1 onto 1..5 with half-star steps', () => {
    expect(starsFromScore(0)).toBe(1);
    expect(starsFromScore(0.5)).toBe(3);
    expect(starsFromScore(1)).toBe(5);
    expect(starsFromScore(0.9)).toBe(4.5);
  });
});
