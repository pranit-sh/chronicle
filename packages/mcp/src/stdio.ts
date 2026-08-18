import { type StdioServerHandle, serveStdio } from "@modelcontextprotocol/server/stdio";

import { type ChronicleServerOptions, createChronicleServer } from "./server.js";

/**
 * Serves Chronicle over stdio. stdout carries the protocol, so callers must not
 * write anything else to it.
 */
export function serveChronicleStdio(options: ChronicleServerOptions = {}): StdioServerHandle {
  return serveStdio(() => createChronicleServer(options));
}
