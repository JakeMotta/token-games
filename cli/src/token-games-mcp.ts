// The `token-games-mcp` command: an MCP server on stdin and stdout (mcp.ts does the work). Logs go to stderr only,
// because stdout carries the protocol.
import readline from 'node:readline';
import { socketCall } from './cli';
import { mcpServer } from './mcp';

const server = mcpServer(socketCall());
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let queue = Promise.resolve();
rl.on('line', (l) => {
  // answer in order, one at a time
  queue = queue.then(() => server.line(l)).then((r) => { if (r) process.stdout.write(JSON.stringify(r) + '\n'); }, (e) => console.error(e));
});
