import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PurrClient } from './client.js';
import { runTool, TOOLS } from './tools.js';

/** Build the MCP server with every Purr tool registered over `client`. */
export function createServer(client: PurrClient): McpServer {
  const server = new McpServer({ name: 'purr', version: '0.1.0' });
  for (const def of TOOLS) {
    server.registerTool(def.name, { description: def.description, inputSchema: def.shape }, async (args) => {
      const r = await runTool(client, def.name, args);
      return { content: [{ type: 'text' as const, text: r.text }], isError: r.isError };
    });
  }
  return server;
}
