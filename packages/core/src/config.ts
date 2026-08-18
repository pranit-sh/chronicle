import { readFile } from "node:fs/promises";

import { parse as parseYaml } from "yaml";

import { ChronicleError, formatZodError } from "./errors.js";
import { atomicWrite } from "./fs-utils.js";
import type { ChroniclePaths } from "./paths.js";
import { type ChronicleConfig, ChronicleConfigSchema, DEFAULT_CONFIG } from "./schema.js";

export async function loadConfig(paths: ChroniclePaths): Promise<ChronicleConfig> {
  let raw: string;
  try {
    raw = await readFile(paths.configFile, "utf8");
  } catch {
    return DEFAULT_CONFIG;
  }
  let parsed: unknown;
  try {
    parsed = raw.trim() ? parseYaml(raw) : {};
  } catch (error) {
    throw new ChronicleError(
      "invalid_config",
      `${paths.configFile} is not valid YAML: ${(error as Error).message}`,
    );
  }
  const result = ChronicleConfigSchema.safeParse(parsed ?? {});
  if (!result.success) {
    throw new ChronicleError(
      "invalid_config",
      formatZodError(result.error, `${paths.configFile} is not a valid Chronicle config:`),
      result.error.issues,
    );
  }
  return result.data;
}

/**
 * The starter config is written as a commented template rather than a machine
 * dump, because the developer is meant to own and edit this file.
 */
export function defaultConfigYaml(): string {
  return `# Chronicle configuration. This file is committed, so knowledge settings
# travel with the branch just like the knowledge itself.
version: 1

# Map a scope id to the code paths that activate it. Scopes are dotted paths,
# and an item scoped "backend" applies to anything resolving under "backend.*".
#
# scopes:
#   backend: ["src/backend/**", "server/**"]
#   backend.api: ["src/backend/api/**"]
#   frontend: ["src/app/**", "src/components/**"]
#   payments.stripe: ["src/payments/stripe/**"]
scopes: {}

# Ceiling on a single resolved context package. The resolver packs the highest
# scoring knowledge until one of these limits is reached.
budget:
  maxItems: 25
  maxChars: 8000

# What an AI agent is allowed to do without a human in the loop.
authority:
  # Agents may stage proposals. They can never accept their own.
  autoLearn: true
  # Agents may propose changes to accepted rules and decisions.
  autoModifyRules: false
  # \`chronicle verify\` may archive items whose evidence has vanished.
  autoArchiveStale: false
  detectContradictions: true

resolver:
  # Stale knowledge is surfaced with a warning rather than silently dropped.
  includeStale: true
  includeProposed: false
  freshnessHorizonDays: 90

# Never read by the verifier, never matched by the resolver.
exclude:
  - "**/node_modules/**"
  - "**/dist/**"
  - "**/build/**"
  - "**/.git/**"
  - "**/.env*"
  - "**/secrets/**"
  - "**/*.pem"
  - "**/*.key"
`;
}

export async function writeDefaultConfig(paths: ChroniclePaths): Promise<void> {
  await atomicWrite(paths.configFile, defaultConfigYaml());
}
