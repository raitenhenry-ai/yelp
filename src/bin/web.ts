#!/usr/bin/env node
import { ToolProofDb } from '../db.js';
import { buildHttpServer } from '../http-server.js';

const port = Number.parseInt(process.env.PORT ?? '4117', 10);
const db = new ToolProofDb();
const server = buildHttpServer(db, process.env.TOOLPROOF_NAME ?? 'ToolProof');
server.listen(port, () => {
  console.log(`toolproof feed + API on http://localhost:${port} (db: ${process.env.TOOLPROOF_DB ?? 'toolproof.db'})`);
});
