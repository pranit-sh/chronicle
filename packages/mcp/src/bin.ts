import path from "node:path";

import { serveCodicilStdio } from "./stdio.js";

// Clients launch MCP servers with a working directory of their own choosing, so
// a relative root is resolved and echoed in full: "serving from ." tells nobody
// anything when the lookup then fails.
const cwd = path.resolve(process.env.CODICIL_ROOT ?? process.cwd());

// stdout belongs to the protocol; diagnostics go to stderr.
process.stderr.write(`codicil mcp: serving knowledge from ${cwd}\n`);

serveCodicilStdio({ cwd });
