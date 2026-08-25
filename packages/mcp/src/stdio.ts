import { type StdioServerHandle, serveStdio } from "@modelcontextprotocol/server/stdio";

import { type CodicilServerOptions, createCodicilServer } from "./server.js";

/**
 * Serves Codicil over stdio. stdout carries the protocol, so callers must not
 * write anything else to it.
 */
export function serveCodicilStdio(options: CodicilServerOptions = {}): StdioServerHandle {
  return serveStdio(() => createCodicilServer(options));
}
