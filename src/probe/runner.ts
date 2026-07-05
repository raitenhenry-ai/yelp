import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ToolProofDb } from '../db.js';
import { ingestOutcome } from '../ingest.js';
import { signOutcome, type ReporterIdentity } from '../signing.js';
import type { ExecutionOutcome } from '../types.js';

/**
 * The probe runner solves cold-start with REAL execution outcomes: it spawns
 * actual MCP servers, runs canned checks against them, and records what
 * happened — signed with the probe fleet's key like any other reporter.
 * "Seed with your own probes" is this file.
 */

export interface ProbeCheck {
  /** Tool name to call on the target server. */
  tool: string;
  args: Record<string, unknown>;
  /** Human description of the task, e.g. "echo a message back". */
  task_kind: string;
  /** If set, the text content of the result must contain this substring. */
  expect_substring?: string;
}

export interface ProbeTarget {
  tool_id: string;
  name: string;
  category: string;
  description: string;
  homepage?: string;
  /** Command used to spawn the MCP server over stdio. */
  command: string;
  args: string[];
  env?: Record<string, string>;
  checks: ProbeCheck[];
  timeout_ms?: number;
}

export interface ProbeRunResult {
  target: ProbeTarget;
  outcomes: ExecutionOutcome[];
}

export async function probeTarget(
  target: ProbeTarget,
  identity: ReporterIdentity,
  db: ToolProofDb,
  log: (msg: string) => void = () => {},
): Promise<ProbeRunResult> {
  const timeoutMs = target.timeout_ms ?? 30_000;
  const outcomes: ExecutionOutcome[] = [];

  db.upsertTool({
    tool_id: target.tool_id,
    name: target.name,
    category: target.category,
    description: target.description,
    homepage: target.homepage ?? null,
  });

  const client = new Client({ name: 'toolproof-probe', version: '0.1.0' });
  const started = Date.now();
  let connected = false;
  try {
    const transport = new StdioClientTransport({
      command: target.command,
      args: target.args,
      env: { ...(process.env as Record<string, string>), ...(target.env ?? {}) },
      stderr: 'ignore',
    });
    await withTimeout(client.connect(transport), timeoutMs, 'connect');
    connected = true;
  } catch (err) {
    // The server never came up — that is itself a real, reportable outcome
    // for every check we intended to run.
    const latency = Date.now() - started;
    const mode = /timed out/i.test(String(err)) ? 'timeout' : 'unavailable';
    for (const check of target.checks) {
      outcomes.push(
        makeOutcome(target, check, identity, {
          status: 'failure',
          failure_mode: mode,
          latency_ms: latency,
          notes: `server failed to start: ${trim(String(err), 120)}`,
        }),
      );
    }
  }

  if (connected) {
    for (const check of target.checks) {
      const t0 = Date.now();
      try {
        const result = (await withTimeout(
          client.callTool({ name: check.tool, arguments: check.args }),
          timeoutMs,
          check.tool,
        )) as { content?: unknown; isError?: boolean };
        const latency = Date.now() - t0;
        const text = extractText(result);
        if (result.isError) {
          outcomes.push(
            makeOutcome(target, check, identity, {
              status: 'failure',
              failure_mode: /unknown tool|not found|invalid_params|-32602/i.test(text)
                ? 'schema_mismatch'
                : 'runtime_error',
              latency_ms: latency,
              notes: trim(text, 120) || 'tool returned isError',
            }),
          );
        } else if (check.expect_substring && !text.includes(check.expect_substring)) {
          outcomes.push(
            makeOutcome(target, check, identity, {
              status: 'failure',
              failure_mode: 'wrong_result',
              latency_ms: latency,
              notes: `expected "${check.expect_substring}" in result, got: ${trim(text, 80)}`,
            }),
          );
        } else {
          outcomes.push(
            makeOutcome(target, check, identity, {
              status: 'success',
              quality: 1,
              latency_ms: latency,
            }),
          );
        }
      } catch (err) {
        const latency = Date.now() - t0;
        const msg = String(err);
        const mode = /timed out/i.test(msg)
          ? 'timeout'
          : /unknown tool|not found/i.test(msg)
            ? 'schema_mismatch'
            : 'runtime_error';
        outcomes.push(
          makeOutcome(target, check, identity, {
            status: 'failure',
            failure_mode: mode,
            latency_ms: latency,
            notes: trim(msg, 120),
          }),
        );
      }
    }
    await client.close().catch(() => {});
  }

  for (const outcome of outcomes) {
    const signed = signOutcome(outcome, identity);
    const res = ingestOutcome(db, signed);
    log(
      `  ${outcome.status === 'success' ? '✓' : '✗'} ${target.name} :: ${outcome.task_kind} ` +
        `(${Math.round(outcome.latency_ms)}ms)${res.accepted ? '' : ` [rejected: ${res.reason}]`}`,
    );
  }

  return { target, outcomes };
}

function makeOutcome(
  target: ProbeTarget,
  check: ProbeCheck,
  identity: ReporterIdentity,
  fields: Pick<ExecutionOutcome, 'status' | 'latency_ms'> &
    Partial<Pick<ExecutionOutcome, 'failure_mode' | 'quality' | 'notes'>>,
): ExecutionOutcome {
  return {
    outcome_id: randomUUID(),
    tool_id: `${target.tool_id}#${check.tool}`,
    tool_name: `${target.name} › ${check.tool}`,
    category: target.category,
    task_kind: check.task_kind,
    reporter_id: identity.reporter_id,
    ts: new Date().toISOString(),
    ...fields,
  };
}

function extractText(result: { content?: unknown }): string {
  const content = result.content;
  if (!Array.isArray(content)) return '';
  return content
    .map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : ''))
    .join('\n');
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function trim(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
