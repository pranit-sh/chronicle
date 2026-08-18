import { serveChronicleStdio } from "./stdio.js";

const cwd = process.env.CHRONICLE_ROOT ?? process.cwd();
// stdout belongs to the protocol; diagnostics go to stderr.
process.stderr.write(`chronicle mcp: serving knowledge from ${cwd}\n`);

serveChronicleStdio({ cwd });
