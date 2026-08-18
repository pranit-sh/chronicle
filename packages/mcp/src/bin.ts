import path from "node:path";

import { serveChronicleStdio } from "./stdio.js";

// Clients launch MCP servers with a working directory of their own choosing, so
// a relative root is resolved and echoed in full: "serving from ." tells nobody
// anything when the lookup then fails.
const cwd = path.resolve(process.env.CHRONICLE_ROOT ?? process.cwd());

// stdout belongs to the protocol; diagnostics go to stderr.
process.stderr.write(`chronicle mcp: serving knowledge from ${cwd}\n`);

serveChronicleStdio({ cwd });
