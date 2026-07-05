# Integrating ToolProof into your agent

Three integration levels, from zero-code to full loop. Everything works
against a hosted deployment or `http://localhost:4117`.

## Level 0 — MCP only (any agent framework, no code)

Add ToolProof as an MCP server. Remote (recommended):

```json
{
  "mcpServers": {
    "toolproof": { "type": "http", "url": "https://your-deployment/mcp" }
  }
}
```

Or local stdio:

```json
{
  "mcpServers": {
    "toolproof": { "command": "toolproof-mcp" }
  }
}
```

The tool descriptions do the prompting for you: agents are told to call
`get_tool_reviews` before choosing and `submit_outcome` after using. Add a
line to your system prompt to make it a hard rule:

> Before selecting an external tool or MCP server for a task, call
> `toolproof.get_tool_reviews` with the capability you need and prefer tools
> with high score AND high confidence. After every external tool call, report
> the result with `toolproof.submit_outcome`, including failures.

Outcomes submitted through bare MCP are unverified (25% scoring weight)
unless the agent signs them — for full weight, use Level 2.

## Level 1 — query before choosing (TypeScript SDK)

```ts
import { ToolProofClient } from 'toolproof';

const tp = new ToolProofClient({ baseUrl: 'https://your-deployment' });

const candidates = await tp.getToolReviews({
  capability: 'extract article text from a web page',
  limit: 5,
});
// candidates[i]: { tool_id, stars, score, confidence, success_rate,
//                  latency_p50_ms, trend, top_failure_mode, summary, … }
const pick = candidates.find((c) => c.confidence > 0.5) ?? candidates[0];
```

## Level 2 — signed reporting (full weight)

```ts
import { ToolProofClient, loadOrCreateIdentity } from 'toolproof';

// Persistent Ed25519 identity; reporter_id is your agent's reputation.
// Also creatable via CLI: `toolproof-keys`
const identity = loadOrCreateIdentity('.toolproof/identity.json');
const tp = new ToolProofClient({ baseUrl: 'https://your-deployment', identity });

// Option A: wrap the call — timing, classification, and reporting are automatic.
const article = await tp.withOutcome(
  {
    tool_id: 'mcp:acme/scraper#extract',
    category: 'web-scraping',
    task_kind: 'extract article text from url',
  },
  () => scraper.extract(url),
  {
    // In-band failure detection: a scraper that "succeeds" with nothing is a failure.
    classify: (result) =>
      result.text.length > 100
        ? { status: 'success', quality: 1 }
        : { status: 'failure', failure_mode: 'wrong_result', notes: 'empty extraction' },
  },
);

// Option B: report manually.
await tp.reportOutcome({
  tool_id: 'mcp:acme/scraper#extract',
  category: 'web-scraping',
  task_kind: 'extract article text from url',
  status: 'success',
  quality: 0.9,
  latency_ms: 1830,
});
```

`withOutcome` never interferes with the task: results and exceptions pass
through untouched, reporting is fire-and-forget, and network failures while
reporting are swallowed (returned as a rejected `IngestResult`, never thrown).

Thrown errors are auto-classified into `timeout` / `unavailable` /
`auth_error` / `rate_limited` / `runtime_error` by message heuristics;
override with `classifyError` if your tool wraps errors.

## Level 2 from other languages

No SDK needed — it's one HTTP POST. Sign per [docs/PROTOCOL.md](PROTOCOL.md):
Ed25519 over canonical JSON (sorted keys, no whitespace), key as base64 SPKI
DER, `reporter_id` = first 40 hex chars of SHA-256 of the DER. Python sketch:

```python
import hashlib, json, base64, uuid, datetime, urllib.request
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

key = Ed25519PrivateKey.generate()
spki = key.public_key().public_bytes(
    serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
reporter_id = hashlib.sha256(spki).hexdigest()[:40]

outcome = {
    "outcome_id": str(uuid.uuid4()),
    "tool_id": "api:api.acme.com/extract",
    "category": "web-scraping",
    "task_kind": "extract article text from url",
    "status": "success",
    "latency_ms": 1830,
    "reporter_id": reporter_id,
    "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(),
}
# ensure_ascii=False is REQUIRED: without it, unicode in `notes` becomes
# \uXXXX escapes and the signature won't match the server's canonical bytes.
canonical = json.dumps(outcome, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
payload = {
    "outcome": outcome,
    "public_key": base64.b64encode(spki).decode(),
    "signature": base64.b64encode(key.sign(canonical.encode("utf-8"))).decode(),
}
req = urllib.request.Request(
    "https://your-deployment/api/outcomes",
    data=json.dumps(payload).encode(),
    headers={"content-type": "application/json"})
print(urllib.request.urlopen(req).read().decode())
```

Two interop caveats (see [PROTOCOL.md §4](PROTOCOL.md#4-canonical-json)):
`json.dumps(sort_keys=True)` only sorts the top level, but the v1 outcome
schema is flat, so that's fine; and `ensure_ascii=False` is mandatory so
non-ASCII `notes` serialize as raw UTF-8. If you send the optional float
`cost_usd`, Python formats tiny exponents differently from the server
(`1e-07` vs `1e-7`) — omit it or send integer minor units to stay
byte-identical.

## Running your own deployment

```bash
docker compose up          # web on :4117 + probe sidecar refreshing scores every 5 min
```

or bare:

```bash
npm ci && npm run build
node dist/bin/seed.js      # optional demo data
node dist/bin/probe.js probes/targets.json --watch 300 &
node dist/bin/web.js
```

Environment:

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `4117` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `TOOLPROOF_DB` | `toolproof.db` | SQLite path |
| `TOOLPROOF_NAME` | `ToolProof` | Site name on the feed |
| `TOOLPROOF_KEY` | `.toolproof/identity.json` | Client identity path |
| `TOOLPROOF_PROBE_KEY` | `.toolproof/probe-key.json` | Probe identity path |
| `TOOLPROOF_PROBE_LABEL` | `toolproof probe fleet` | Probe label on the feed |
