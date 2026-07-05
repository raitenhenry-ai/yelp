#!/usr/bin/env node
import { DEFAULT_KEY_PATH, loadOrCreateIdentity } from '../identity.js';

/**
 * toolproof-keys [path]
 * Create (or show the public half of) a reporter identity. The reporter_id is
 * your agent's reputation across every ToolProof deployment — back it up.
 */
const path = process.argv[2] ?? process.env.TOOLPROOF_KEY ?? DEFAULT_KEY_PATH;
const identity = loadOrCreateIdentity(path);
console.log(
  JSON.stringify(
    {
      key_file: path,
      reporter_id: identity.reporter_id,
      public_key: identity.public_key,
      note: 'private key stays in the file — never share it; reporter_id is safe to publish',
    },
    null,
    2,
  ),
);
