import { randomUUID } from 'node:crypto';
import { ToolProofDb } from '../src/db.js';
import type { ExecutionOutcome } from '../src/types.js';

export function memDb(): ToolProofDb {
  return new ToolProofDb(':memory:');
}

export function outcome(overrides: Partial<ExecutionOutcome> = {}): ExecutionOutcome {
  return {
    outcome_id: randomUUID(),
    tool_id: 'mcp:test/tool',
    tool_name: 'Test Tool',
    category: 'testing',
    task_kind: 'do a test thing',
    status: 'success',
    latency_ms: 500,
    reporter_id: 'a'.repeat(40),
    ts: new Date().toISOString(),
    ...overrides,
  };
}

export function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}
