import { CodicilError } from "@codicil/core";

/** Commander reducer for repeatable options. */
export function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export function parseNumber(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new CodicilError("invalid_input", `--${label} must be a number, got "${value}"`);
  }
  return parsed;
}

export function parseInteger(value: string | undefined, label: string): number | undefined {
  const parsed = parseNumber(value, label);
  if (parsed === undefined) return undefined;
  if (!Number.isInteger(parsed)) {
    throw new CodicilError("invalid_input", `--${label} must be a whole number, got "${value}"`);
  }
  return parsed;
}
