#!/usr/bin/env node
import { openDb } from '../db.js';
import { buildHttpServer } from '../http-server.js';

const port = Number.parseInt(process.env.PORT ?? '4117', 10);
const host = process.env.HOST ?? '0.0.0.0';
const db = await openDb();
const server = buildHttpServer(db, process.env.FILTERLY_NAME ?? 'Filterly');
const backend = process.env.DATABASE_URL ? 'postgres' : (process.env.FILTERLY_DB ?? 'filterly.db');

server.listen(port, host, () => {
  console.log(
    `filterly up on http://${host}:${port} — feed at /, MCP at /mcp, API at /api/* (db: ${backend})`,
  );
});

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    console.log(`${signal} received, draining connections…`);
    server.close(() => {
      void db.close().then(() => process.exit(0));
    });
    // Hard exit if connections refuse to drain.
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
