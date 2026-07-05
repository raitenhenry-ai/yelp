import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { generateReporterIdentity, type ReporterIdentity } from './signing.js';

/**
 * Persistent reporter identity. The reporter_id is the agent's reputation —
 * losing the key means starting over, so it lives in a file (0600) rather
 * than memory. Default path can be overridden with FILTERLY_KEY.
 */
export const DEFAULT_KEY_PATH = '.filterly/identity.json';

export function loadOrCreateIdentity(
  path: string = process.env.FILTERLY_KEY ?? DEFAULT_KEY_PATH,
): ReporterIdentity {
  if (existsSync(path)) {
    let identity: ReporterIdentity;
    try {
      identity = JSON.parse(readFileSync(path, 'utf8')) as ReporterIdentity;
    } catch {
      throw new Error(`identity file ${path} is malformed (not valid JSON)`);
    }
    if (!identity.reporter_id || !identity.public_key || !identity.private_key) {
      throw new Error(`identity file ${path} is malformed (missing key fields)`);
    }
    return identity;
  }
  const identity = generateReporterIdentity();
  mkdirSync(dirname(path) || '.', { recursive: true });
  writeFileSync(path, JSON.stringify(identity, null, 2) + '\n', { mode: 0o600 });
  return identity;
}
