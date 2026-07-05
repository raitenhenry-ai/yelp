#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openDb } from '../db.js';
import { buildMcpServer } from '../mcp-server.js';

const db = await openDb();
const server = buildMcpServer(db);
await server.connect(new StdioServerTransport());
const backend = process.env.DATABASE_URL ? 'postgres' : (process.env.TOOLPROOF_DB ?? 'toolproof.db');
console.error(`toolproof MCP server ready (db: ${backend})`);
