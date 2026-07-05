import { describe, expect, it } from 'vitest';
import { ingestOutcome } from '../src/ingest.js';
import { generateReporterIdentity, signOutcome } from '../src/signing.js';
import { memDb, outcome } from './helpers.js';

describe('ingestOutcome', () => {
  it('accepts a valid signed outcome as verified and auto-registers the tool', async () => {
    const db = await memDb();
    const identity = generateReporterIdentity();
    const o = outcome({ reporter_id: identity.reporter_id });
    const res = await ingestOutcome(db, signOutcome(o, identity));
    expect(res).toMatchObject({ accepted: true, verified: true });
    expect((await db.getTool('mcp:test/tool'))?.name).toBe('Test Tool');
    expect((await db.outcomesForTool('mcp:test/tool'))[0]?.verified).toBe(true);
  });

  it('accepts an unsigned outcome as unverified', async () => {
    const db = await memDb();
    const res = await ingestOutcome(db, { outcome: outcome() });
    expect(res).toMatchObject({ accepted: true, verified: false });
  });

  it('rejects a forged signature outright', async () => {
    const db = await memDb();
    const identity = generateReporterIdentity();
    const o = outcome({ reporter_id: identity.reporter_id });
    const signed = signOutcome(o, identity);
    signed.outcome = { ...signed.outcome, status: 'failure' };
    const res = await ingestOutcome(db, signed);
    expect(res.accepted).toBe(false);
    expect(res.reason).toMatch(/signature/);
    expect(await db.countOutcomes()).toBe(0);
  });

  it('rejects malformed outcomes with a schema reason', async () => {
    const db = await memDb();
    const res = await ingestOutcome(db, { outcome: { ...outcome(), status: 'amazing' } });
    expect(res.accepted).toBe(false);
    expect(res.reason).toMatch(/schema/);
  });

  it('dedupes on outcome_id', async () => {
    const db = await memDb();
    const o = outcome();
    expect((await ingestOutcome(db, { outcome: o })).accepted).toBe(true);
    const dup = await ingestOutcome(db, { outcome: o });
    expect(dup.accepted).toBe(false);
    expect(dup.reason).toMatch(/duplicate/);
  });

  it('enforces the per-tool daily rate cap', async () => {
    const db = await memDb();
    const limits = { perToolPerDay: 3, totalPerDay: 100 };
    for (let i = 0; i < 3; i++) {
      expect((await ingestOutcome(db, { outcome: outcome() }, limits)).accepted).toBe(true);
    }
    const res = await ingestOutcome(db, { outcome: outcome() }, limits);
    expect(res.accepted).toBe(false);
    expect(res.reason).toMatch(/rate limit/);
  });

  it('caps notes at 280 chars via schema', async () => {
    const db = await memDb();
    const res = await ingestOutcome(db, { outcome: outcome({ notes: 'x'.repeat(281) }) });
    expect(res.accepted).toBe(false);
  });
});
