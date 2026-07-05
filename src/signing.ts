import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from 'node:crypto';
import { canonicalJson } from './canonical.js';
import type { ExecutionOutcome, SignedOutcome } from './types.js';

export interface ReporterIdentity {
  /** reporter_id = first 40 hex chars of the SHA-256 fingerprint of the SPKI
   * DER public key (see PROTOCOL.md §3). */
  reporter_id: string;
  /** Base64 SPKI DER Ed25519 public key. */
  public_key: string;
  /** Base64 PKCS8 DER Ed25519 private key. Keep secret. */
  private_key: string;
}

export function generateReporterIdentity(): ReporterIdentity {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer;
  return {
    reporter_id: fingerprintSpki(spki),
    public_key: spki.toString('base64'),
    private_key: pkcs8.toString('base64'),
  };
}

export function fingerprintPublicKey(publicKeyB64: string): string {
  return fingerprintSpki(Buffer.from(publicKeyB64, 'base64'));
}

function fingerprintSpki(spkiDer: Buffer): string {
  return createHash('sha256').update(spkiDer).digest('hex').slice(0, 40);
}

function privateKeyFromB64(privateKeyB64: string): KeyObject {
  return createPrivateKey({
    key: Buffer.from(privateKeyB64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
}

function publicKeyFromB64(publicKeyB64: string): KeyObject {
  return createPublicKey({
    key: Buffer.from(publicKeyB64, 'base64'),
    format: 'der',
    type: 'spki',
  });
}

/** Sign an outcome, producing the wire-format SignedOutcome envelope. */
export function signOutcome(outcome: ExecutionOutcome, identity: ReporterIdentity): SignedOutcome {
  const payload = Buffer.from(canonicalJson(outcome), 'utf8');
  const signature = edSign(null, payload, privateKeyFromB64(identity.private_key));
  return {
    outcome,
    public_key: identity.public_key,
    signature: signature.toString('base64'),
  };
}

/**
 * Verify a signed outcome. Returns true only if the signature is valid AND
 * the outcome's reporter_id matches the fingerprint of the signing key —
 * a reporter cannot sign outcomes attributed to someone else.
 */
export function verifyOutcome(signed: SignedOutcome): boolean {
  if (!signed.public_key || !signed.signature) return false;
  if (signed.outcome.reporter_id !== fingerprintPublicKey(signed.public_key)) return false;
  try {
    const payload = Buffer.from(canonicalJson(signed.outcome), 'utf8');
    return edVerify(
      null,
      payload,
      publicKeyFromB64(signed.public_key),
      Buffer.from(signed.signature, 'base64'),
    );
  } catch {
    return false;
  }
}
