import type { ToolProofDb } from './db.js';
import { SignedOutcomeSchema, type IngestResult, type SignedOutcome } from './types.js';
import { verifyOutcome } from './signing.js';

/**
 * Ingest pipeline: validate → verify signature → dedupe → rate-cap → clamp
 * future ts → store.
 *
 * Unsigned outcomes are accepted but marked unverified — scoring weights them
 * at a fraction of verified ones. Signed outcomes must have a signature that
 * checks out AND a reporter_id matching the signing key's fingerprint;
 * a bad signature is rejected outright (it's a forgery attempt, not merely
 * missing provenance).
 */
export interface IngestLimits {
  /** Max outcomes per reporter per tool per day. */
  perToolPerDay: number;
  /** Max outcomes per reporter per day across all tools. */
  totalPerDay: number;
}

export const DEFAULT_LIMITS: IngestLimits = {
  perToolPerDay: 200,
  totalPerDay: 5000,
};

export async function ingestOutcome(
  db: ToolProofDb,
  input: unknown,
  limits: IngestLimits = DEFAULT_LIMITS,
): Promise<IngestResult> {
  const parsed = SignedOutcomeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      accepted: false,
      verified: false,
      reason: `schema: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`,
      outcome_id: String((input as { outcome?: { outcome_id?: unknown } })?.outcome?.outcome_id ?? ''),
    };
  }
  const signed: SignedOutcome = parsed.data;
  const o = signed.outcome;

  let verified = false;
  if (signed.signature || signed.public_key) {
    if (!verifyOutcome(signed)) {
      return {
        accepted: false,
        verified: false,
        reason: 'invalid signature or reporter_id does not match signing key',
        outcome_id: o.outcome_id,
      };
    }
    verified = true;
  }

  if (await db.hasOutcome(o.outcome_id)) {
    return { accepted: false, verified, reason: 'duplicate outcome_id', outcome_id: o.outcome_id };
  }

  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  if ((await db.reporterOutcomeCountSince(o.reporter_id, o.tool_id, dayAgo)) >= limits.perToolPerDay) {
    return {
      accepted: false,
      verified,
      reason: 'rate limit: too many outcomes for this tool today',
      outcome_id: o.outcome_id,
    };
  }
  if ((await db.reporterTotalSince(o.reporter_id, dayAgo)) >= limits.totalPerDay) {
    return {
      accepted: false,
      verified,
      reason: 'rate limit: reporter daily cap reached',
      outcome_id: o.outcome_id,
    };
  }

  // Clamp a future-dated timestamp to now. `ts` is reporter-controlled and the
  // recency half-life keys on it, so a far-future ts would otherwise lock in
  // maximum, never-decaying weight and count as "recent" for trend forever.
  // The signature has already been verified against the original ts above;
  // clamping only affects how the stored outcome ages.
  const FUTURE_SKEW_MS = 2 * 60_000;
  if (new Date(o.ts).getTime() > Date.now() + FUTURE_SKEW_MS) {
    o.ts = new Date().toISOString();
  }

  await db.ensureReporter(o.reporter_id, { public_key: signed.public_key ?? null });
  await db.ensureTool(o.tool_id, o.tool_name ?? o.tool_id, o.category);
  await db.insertOutcome(o, verified);

  return { accepted: true, verified, outcome_id: o.outcome_id };
}
