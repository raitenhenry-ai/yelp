import type { StoredOutcome, ToolScore, ToolRecord } from './types.js';

/**
 * Scoring model
 * -------------
 * Tool APIs change weekly, so evidence decays fast, and unsigned reports are
 * cheap to fake, so verification dominates weight. Each outcome i contributes:
 *
 *   w_i = 0.5^(age_days / HALF_LIFE_DAYS) * (verified ? 1.0 : UNVERIFIED_WEIGHT)
 *   v_i = success: (quality ?? 1) | partial: 0.5 * (quality ?? 1) | failure: 0
 *
 * Anti-gaming: within a single tool, one reporter's weight is capped at
 * max(REPORTER_SHARE_CAP, 2/n_reporters) of the tool's post-cap total once
 * ≥3 reporters exist, so a vendor running one enthusiastic agent can't
 * outvote the crowd, while small-crowd tools keep their legitimate signal.
 *
 * score      = (Σ w·v + PRIOR_A) / (Σ w + PRIOR_A + PRIOR_B)   — Beta(1,1) prior
 * confidence = N_eff / (N_eff + CONFIDENCE_K)
 * rank_score = confidence * score + (1 - confidence) * 0.5     — for ordering
 * stars      = 1 + 4 * score, half-star resolution
 */
export interface ScoringOptions {
  halfLifeDays: number;
  unverifiedWeight: number;
  reporterShareCap: number;
  priorA: number;
  priorB: number;
  confidenceK: number;
  now: Date;
}

export const DEFAULT_SCORING: ScoringOptions = {
  halfLifeDays: 14,
  unverifiedWeight: 0.25,
  reporterShareCap: 0.4,
  priorA: 1,
  priorB: 1,
  confidenceK: 5,
  now: new Date(),
};

interface WeightedOutcome {
  outcome: StoredOutcome;
  weight: number;
  value: number;
}

export function outcomeValue(o: Pick<StoredOutcome, 'status' | 'quality'>): number {
  const q = o.quality ?? 1;
  if (o.status === 'success') return q;
  if (o.status === 'partial') return 0.5 * q;
  return 0;
}

export function recencyWeight(tsIso: string, opts: ScoringOptions): number {
  const ageMs = opts.now.getTime() - new Date(tsIso).getTime();
  const ageDays = Math.max(0, ageMs) / 86_400_000;
  return Math.pow(0.5, ageDays / opts.halfLifeDays);
}

function weighOutcomes(outcomes: StoredOutcome[], opts: ScoringOptions): WeightedOutcome[] {
  const weighted: WeightedOutcome[] = outcomes.map((outcome) => ({
    outcome,
    weight:
      recencyWeight(outcome.ts, opts) * (outcome.verified ? 1 : opts.unverifiedWeight),
    value: outcomeValue(outcome),
  }));

  // Cap any single reporter's share of the FINAL total weight. Scaling a
  // reporter down shrinks the total, which tightens the cap, so iterate to
  // the fixed point (converges: at most two reporters can exceed a 40% share
  // simultaneously, giving a contraction factor < 1).
  // With few reporters a dominant share is expected (2 reporters ⇒ someone
  // holds ≥50%), and capping would just flatten legitimate signal like the
  // verified-vs-unverified weighting; so the cap relaxes to 2/n and only
  // starts binding once a real crowd exists.
  const reporters = new Set(weighted.map((w) => w.outcome.reporter_id));
  const shareCap = Math.max(opts.reporterShareCap, 2 / reporters.size);
  if (reporters.size >= 3 && shareCap < 1) {
    for (let pass = 0; pass < 25; pass++) {
      const byReporter = new Map<string, number>();
      let total = 0;
      for (const w of weighted) {
        byReporter.set(
          w.outcome.reporter_id,
          (byReporter.get(w.outcome.reporter_id) ?? 0) + w.weight,
        );
        total += w.weight;
      }
      if (total <= 0) break;
      let violated = false;
      for (const [reporter, sum] of byReporter) {
        const cap = shareCap * total;
        if (sum > cap * 1.001) {
          violated = true;
          const scale = cap / sum;
          for (const w of weighted) {
            if (w.outcome.reporter_id === reporter) w.weight *= scale;
          }
        }
      }
      if (!violated) break;
    }
  }
  return weighted;
}

export function scoreTool(
  tool: ToolRecord,
  outcomes: StoredOutcome[],
  optsIn: Partial<ScoringOptions> = {},
): ToolScore {
  const opts: ScoringOptions = { ...DEFAULT_SCORING, now: new Date(), ...optsIn };
  const weighted = weighOutcomes(outcomes, opts);

  let sumW = 0;
  let sumWV = 0;
  for (const { weight, value } of weighted) {
    sumW += weight;
    sumWV += weight * value;
  }

  const score = (sumWV + opts.priorA) / (sumW + opts.priorA + opts.priorB);
  const confidence = sumW / (sumW + opts.confidenceK);
  const rankScore = confidence * score + (1 - confidence) * 0.5;
  const successRate = sumW > 0 ? sumWV / sumW : 0;

  // Weighted median latency of successful runs.
  const successes = weighted
    .filter((w) => w.outcome.status === 'success')
    .sort((a, b) => a.outcome.latency_ms - b.outcome.latency_ms);
  let latencyP50: number | null = null;
  const successW = successes.reduce((acc, w) => acc + w.weight, 0);
  if (successW > 0) {
    let acc = 0;
    for (const w of successes) {
      acc += w.weight;
      if (acc >= successW / 2) {
        latencyP50 = w.outcome.latency_ms;
        break;
      }
    }
  }

  // Trend: raw success value in the last 7 days vs the 21 days before that.
  const weekAgo = opts.now.getTime() - 7 * 86_400_000;
  const monthAgo = opts.now.getTime() - 28 * 86_400_000;
  const recent = outcomes.filter((o) => new Date(o.ts).getTime() >= weekAgo);
  const prior = outcomes.filter((o) => {
    const t = new Date(o.ts).getTime();
    return t >= monthAgo && t < weekAgo;
  });
  let trend: ToolScore['trend'] = 'insufficient';
  if (recent.length >= 3 && prior.length >= 3) {
    const avg = (xs: StoredOutcome[]) => xs.reduce((a, o) => a + outcomeValue(o), 0) / xs.length;
    const delta = avg(recent) - avg(prior);
    trend = delta > 0.1 ? 'improving' : delta < -0.1 ? 'declining' : 'stable';
  }

  // Most common failure mode among recent failures (recency-weighted).
  const failureWeights = new Map<string, number>();
  for (const { outcome, weight } of weighted) {
    if (outcome.status === 'failure') {
      const mode = outcome.failure_mode ?? 'other';
      failureWeights.set(mode, (failureWeights.get(mode) ?? 0) + weight);
    }
  }
  let topFailureMode: string | null = null;
  let topW = 0;
  for (const [mode, w] of failureWeights) {
    if (w > topW) {
      topW = w;
      topFailureMode = mode;
    }
  }

  return {
    tool_id: tool.tool_id,
    name: tool.name,
    category: tool.category,
    description: tool.description,
    score: round3(score),
    confidence: round3(confidence),
    rank_score: round3(rankScore),
    stars: starsFromScore(score),
    n_outcomes: outcomes.length,
    n_verified: outcomes.filter((o) => o.verified).length,
    n_reporters: new Set(outcomes.map((o) => o.reporter_id)).size,
    success_rate: round3(successRate),
    latency_p50_ms: latencyP50,
    trend,
    last_outcome_at: outcomes.length
      ? outcomes.reduce((max, o) => (o.ts > max ? o.ts : max), outcomes[0].ts)
      : null,
    top_failure_mode: topFailureMode,
  };
}

export function starsFromScore(score: number): number {
  return Math.round((1 + 4 * score) * 2) / 2;
}

/** Stars for a single outcome — used on the feed. */
export function starsForOutcome(o: Pick<StoredOutcome, 'status' | 'quality'>): number {
  if (o.status === 'failure') return 1;
  return Math.max(1, starsFromScore(outcomeValue(o)));
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
