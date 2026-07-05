import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/canonical.js';
import {
  fingerprintPublicKey,
  generateReporterIdentity,
  signOutcome,
  verifyOutcome,
} from '../src/signing.js';
import { outcome } from './helpers.js';

describe('canonicalJson', () => {
  it('sorts keys at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [{ z: 1, y: 2 }] } })).toBe(
      '{"a":{"c":[{"y":2,"z":1}],"d":2},"b":1}',
    );
  });

  it('drops undefined values and is insensitive to key insertion order', () => {
    const a = { x: 1, y: undefined, z: 2 };
    const b = { z: 2, x: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('rejects non-finite numbers', () => {
    expect(() => canonicalJson({ a: Infinity })).toThrow();
  });
});

describe('signing', () => {
  it('signs and verifies an outcome', () => {
    const identity = generateReporterIdentity();
    const o = outcome({ reporter_id: identity.reporter_id });
    const signed = signOutcome(o, identity);
    expect(verifyOutcome(signed)).toBe(true);
  });

  it('rejects a tampered outcome', () => {
    const identity = generateReporterIdentity();
    const o = outcome({ reporter_id: identity.reporter_id, status: 'failure' });
    const signed = signOutcome(o, identity);
    signed.outcome = { ...signed.outcome, status: 'success' };
    expect(verifyOutcome(signed)).toBe(false);
  });

  it('rejects an outcome attributed to a different reporter than the signing key', () => {
    const identity = generateReporterIdentity();
    const other = generateReporterIdentity();
    const o = outcome({ reporter_id: other.reporter_id });
    const signed = signOutcome(o, identity); // signs fine, but attribution mismatches
    expect(verifyOutcome(signed)).toBe(false);
  });

  it('derives reporter_id as the fingerprint of the public key', () => {
    const identity = generateReporterIdentity();
    expect(fingerprintPublicKey(identity.public_key)).toBe(identity.reporter_id);
  });
});
