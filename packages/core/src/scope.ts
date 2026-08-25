import picomatch from "picomatch";

import { type CodicilConfig, ROOT_SCOPE } from "./schema.js";

/**
 * Scopes form a dotted hierarchy: `backend.api.auth` inherits from
 * `backend.api`, which inherits from `backend`, which inherits from the
 * implicit root `project`. Knowledge attached to an ancestor applies to every
 * descendant, which is what makes "editing login.ts pulls Project + Backend +
 * API + Auth knowledge" fall out of the model rather than being special cased.
 */

/** `backend.api.auth` becomes `[project, backend, backend.api, backend.api.auth]`. */
export function scopeChain(scope: string): string[] {
  if (scope === ROOT_SCOPE) return [ROOT_SCOPE];
  const segments = scope.split(".");
  const chain: string[] = [ROOT_SCOPE];
  for (let index = 0; index < segments.length; index += 1) {
    chain.push(segments.slice(0, index + 1).join("."));
  }
  return chain;
}

export function scopeDepth(scope: string): number {
  return scope === ROOT_SCOPE ? 0 : scope.split(".").length;
}

/** True when `candidate` is the same scope as `scope` or an ancestor of it. */
export function coversScope(candidate: string, scope: string): boolean {
  if (candidate === ROOT_SCOPE) return true;
  return candidate === scope || scope.startsWith(`${candidate}.`);
}

/** Drops any scope that an also-present descendant already implies. */
export function mostSpecific(scopes: readonly string[]): string[] {
  return scopes.filter(
    (scope) => !scopes.some((other) => other !== scope && coversScope(scope, other)),
  );
}

type Matcher = (input: string) => boolean;

function compile(globs: readonly string[]): Matcher {
  if (globs.length === 0) return () => false;
  return picomatch(globs as string[], { dot: true });
}

/**
 * Turns a file path into the scope chain that is active for it, using the
 * `scopes` map from `.codicil/config.yaml`.
 */
export class ScopeResolver {
  #scopeMatchers: Array<{ scope: string; matches: Matcher }>;
  #excluded: Matcher;

  constructor(config: CodicilConfig) {
    this.#scopeMatchers = Object.entries(config.scopes)
      .map(([scope, globs]) => ({ scope, matches: compile(globs) }))
      // Deepest first so callers can read the most specific match off the top.
      .sort((a, b) => scopeDepth(b.scope) - scopeDepth(a.scope));
    this.#excluded = compile(config.exclude);
  }

  isExcluded(repoRelativePath: string): boolean {
    return this.#excluded(repoRelativePath);
  }

  /** Every scope activated by this path, ordered root first. */
  scopesForPath(repoRelativePath: string): string[] {
    const active = new Set<string>([ROOT_SCOPE]);
    for (const { scope, matches } of this.#scopeMatchers) {
      if (matches(repoRelativePath)) {
        for (const ancestor of scopeChain(scope)) active.add(ancestor);
      }
    }
    return [...active].sort((a, b) => scopeDepth(a) - scopeDepth(b) || a.localeCompare(b));
  }

  /** The union of scopes activated by several paths. */
  scopesForPaths(repoRelativePaths: readonly string[]): string[] {
    const active = new Set<string>([ROOT_SCOPE]);
    for (const path of repoRelativePaths) {
      for (const scope of this.scopesForPath(path)) active.add(scope);
    }
    return [...active].sort((a, b) => scopeDepth(a) - scopeDepth(b) || a.localeCompare(b));
  }

  /** The deepest scope activated by a path, used to measure specificity. */
  deepestScopeForPath(repoRelativePath: string): string {
    const scopes = this.scopesForPath(repoRelativePath);
    return scopes[scopes.length - 1] ?? ROOT_SCOPE;
  }
}

/** Matches an item's own `paths` globs against a file. */
export function pathsMatch(globs: readonly string[], repoRelativePath: string): boolean {
  return compile(globs)(repoRelativePath);
}
