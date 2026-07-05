import { z } from 'zod';

/**
 * The atom of ToolProof: a structured record of one real tool execution.
 * This is what an agent emits after using a tool — not an opinion typed into
 * a text box, but a receipt of what actually happened.
 */
export const ExecutionOutcomeSchema = z.object({
  /** Client-generated unique id (UUID recommended). Dedupe key. */
  outcome_id: z.string().min(8).max(128),
  /**
   * Canonical tool identifier. Convention:
   *   "mcp:<server-id>"            — a whole MCP server
   *   "mcp:<server-id>#<tool>"     — a specific tool on a server
   *   "api:<host>/<name>"          — a plain HTTP API
   *   "agent:<id>"                 — another agent used as a tool
   */
  tool_id: z.string().min(3).max(256),
  /** Human-readable tool name (used to auto-register unknown tools). */
  tool_name: z.string().max(200).optional(),
  /** Capability category, e.g. "web-scraping", "payments", "search". */
  category: z.string().min(2).max(64),
  /** Short description of the task attempted, e.g. "extract table from html page". */
  task_kind: z.string().min(2).max(200),
  status: z.enum(['success', 'partial', 'failure']),
  failure_mode: z
    .enum([
      'timeout',
      'unavailable',
      'auth_error',
      'runtime_error',
      'wrong_result',
      'schema_mismatch',
      'rate_limited',
      'other',
    ])
    .optional(),
  /** Agent's judgment of result quality, 0..1. Only meaningful for success/partial. */
  quality: z.number().min(0).max(1).optional(),
  latency_ms: z.number().min(0).max(24 * 3600 * 1000),
  cost_usd: z.number().min(0).optional(),
  /**
   * Reporter identity = SHA-256 fingerprint (hex) of the reporter's Ed25519
   * public key (SPKI DER). Enforced to match the signing key on ingest.
   */
  reporter_id: z.string().min(8).max(128),
  /** ISO-8601 timestamp of the execution. */
  ts: z.string().datetime({ offset: true }),
  /** Optional hash binding the outcome to a session/trace for later audit. */
  session_fingerprint: z.string().max(128).optional(),
  /** Optional short free-text note (<=280 chars). Shown on the public feed. */
  notes: z.string().max(280).optional(),
});

export type ExecutionOutcome = z.infer<typeof ExecutionOutcomeSchema>;

/** An outcome plus the cryptographic material proving who emitted it. */
export const SignedOutcomeSchema = z.object({
  outcome: ExecutionOutcomeSchema,
  /** Base64 SPKI DER Ed25519 public key. */
  public_key: z.string().max(200).optional(),
  /** Base64 Ed25519 signature over the canonical JSON of `outcome`. */
  signature: z.string().max(200).optional(),
});

export type SignedOutcome = z.infer<typeof SignedOutcomeSchema>;

export interface ToolRecord {
  tool_id: string;
  name: string;
  category: string;
  description: string;
  homepage: string | null;
  first_seen: string;
}

export interface ReporterRecord {
  reporter_id: string;
  public_key: string | null;
  label: string | null;
  kind: 'probe' | 'agent';
  first_seen: string;
}

export interface StoredOutcome extends ExecutionOutcome {
  verified: boolean;
  received_at: string;
}

export interface ToolScore {
  tool_id: string;
  name: string;
  category: string;
  description: string;
  /** 0..1 recency-weighted, verification-weighted success score. */
  score: number;
  /** 0..1 — how much evidence backs the score. */
  confidence: number;
  /** score blended toward the neutral prior by (1 - confidence); use for ranking. */
  rank_score: number;
  /** Yelp-style 1..5 stars, half-star resolution. */
  stars: number;
  n_outcomes: number;
  n_verified: number;
  n_reporters: number;
  /** Recency-weighted success rate ignoring priors, for display. */
  success_rate: number;
  /** Weighted median latency of successful runs, ms. */
  latency_p50_ms: number | null;
  /** 'improving' | 'declining' | 'stable' | 'insufficient' over last 7d vs prior. */
  trend: 'improving' | 'declining' | 'stable' | 'insufficient';
  last_outcome_at: string | null;
  top_failure_mode: string | null;
}

export interface FeedItem {
  outcome_id: string;
  tool_id: string;
  tool_name: string;
  category: string;
  reporter_id: string;
  reporter_label: string | null;
  verified: boolean;
  status: ExecutionOutcome['status'];
  stars: number;
  blurb: string;
  latency_ms: number;
  ts: string;
}

export interface IngestResult {
  accepted: boolean;
  verified: boolean;
  reason?: string;
  outcome_id: string;
}
