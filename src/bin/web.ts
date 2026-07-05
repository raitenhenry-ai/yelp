#!/usr/bin/env node
import { ToolProofDb } from '../db.js';
import { buildHttpServer } from '../http-server.js';

const port = Number.parseInt(process.env.PORT ?? '4117', 10);
const host = process.env.HOST ?? '0.0.0.0';
const db = new ToolProofDb();
const server = buildHttpServer(db, process.env.TOOLPROOF_NAME ?? 'ToolProof');

server.listen(port, host, () => {
  console.log(
    `toolproof up on http://${host}:${port} — feed at /, MCP at /mcp, API at /api/* ` +
      `(db: ${process.env.TOOLPROOF_DB ?? 'toolproof.db'})`,
  );
});

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    console.log(`${signal} received, draining connections…`);
    server.close(() => {
      db.close();
      process.exit(0);
    });
    // Hard exit if connections refuse to drain.
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
