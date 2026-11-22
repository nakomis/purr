import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PurrClient } from './client.js';
import { loadConfig } from './config.js';
import { createServer } from './server.js';

try {
  const client = new PurrClient(loadConfig());
  await createServer(client).connect(new StdioServerTransport());
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
