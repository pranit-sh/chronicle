import type { ZodError } from "zod";

export type ChronicleErrorCode =
  | "not_initialized"
  | "already_initialized"
  | "not_found"
  | "ambiguous_reference"
  | "invalid_document"
  | "invalid_config"
  | "invalid_input"
  | "forbidden"
  | "conflict";

export class ChronicleError extends Error {
  readonly code: ChronicleErrorCode;
  readonly details: unknown;

  constructor(code: ChronicleErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ChronicleError";
    this.code = code;
    this.details = details;
  }
}

export function formatZodError(error: ZodError, label: string): string {
  const lines = error.issues.map((issue) => {
    const where = issue.path.length ? issue.path.join(".") : "(root)";
    return `  ${where}: ${issue.message}`;
  });
  return `${label}\n${lines.join("\n")}`;
}
