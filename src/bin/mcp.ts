#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ToolProofDb } from '../db.js';
import { buildMcpServer } from '../mcp-server.js';

const db = new ToolProofDb();
const server = buildMcpServer(db);
await server.connect(new StdioServerTransport());
console.error(`toolproof MCP server ready (db: ${process.env.TOOLPROOF_DB ?? 'toolproof.db'})`);
