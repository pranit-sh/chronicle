import { describe, expect, it } from "vitest";

import { ScopeResolver, coversScope, mostSpecific, pathsMatch, scopeChain, scopeDepth } from "../src/scope.js";
import { LAYERED_SCOPES, makeConfig } from "./fixtures.js";

describe("scopeChain", () => {
  it("walks from the implicit root down to the scope", () => {
    expect(scopeChain("backend.api.auth")).toEqual([
      "project",
      "backend",
      "backend.api",
      "backend.api.auth",
    ]);
  });

  it("treats the root as its own chain", () => {
    expect(scopeChain("project")).toEqual(["project"]);
  });
});

describe("coversScope", () => {
  it("lets ancestors cover their descendants", () => {
    expect(coversScope("backend", "backend.api.auth")).toBe(true);
    expect(coversScope("backend.api", "backend.api")).toBe(true);
    expect(coversScope("project", "anything.at.all")).toBe(true);
  });

  it("does not let a narrower scope cover a broader one", () => {
    expect(coversScope("backend.api.auth", "backend.api")).toBe(false);
    expect(coversScope("frontend", "backend")).toBe(false);
  });

  it("does not treat a shared prefix as a hierarchy", () => {
    expect(coversScope("back", "backend")).toBe(false);
  });
});

describe("scopeDepth", () => {
  it("counts the root as zero", () => {
    expect(scopeDepth("project")).toBe(0);
    expect(scopeDepth("backend")).toBe(1);
    expect(scopeDepth("backend.api.auth")).toBe(3);
  });
});

describe("mostSpecific", () => {
  it("drops ancestors that a descendant already implies", () => {
    expect(mostSpecific(["backend", "backend.api", "frontend"])).toEqual(["backend.api", "frontend"]);
  });
});

describe("ScopeResolver", () => {
  const resolver = new ScopeResolver(makeConfig({ scopes: LAYERED_SCOPES }));

  it("activates the whole ancestor chain for a file", () => {
    expect(resolver.scopesForPath("src/backend/api/auth/login.ts")).toEqual([
      "project",
      "backend",
      "backend.api",
      "backend.api.auth",
    ]);
  });

  it("stops at the scopes that actually match", () => {
    expect(resolver.scopesForPath("src/backend/worker.ts")).toEqual(["project", "backend"]);
  });

  it("falls back to the root scope for unmapped paths", () => {
    expect(resolver.scopesForPath("scripts/release.ts")).toEqual(["project"]);
  });

  it("activates a directory the same way as a file inside it", () => {
    expect(resolver.deepestScopeForPath("src/backend/api")).toBe("backend.api");
  });

  it("unions the scopes of several open files", () => {
    expect(resolver.scopesForPaths(["src/backend/api/users.ts", "src/app/page.tsx"])).toEqual([
      "project",
      "backend",
      "frontend",
      "backend.api",
    ]);
  });

  it("reports the deepest scope for a path", () => {
    expect(resolver.deepestScopeForPath("src/backend/api/auth/login.ts")).toBe("backend.api.auth");
    expect(resolver.deepestScopeForPath("README.md")).toBe("project");
  });

  it("knows which paths are excluded from the knowledge layer", () => {
    expect(resolver.isExcluded("node_modules/left-pad/index.js")).toBe(true);
    expect(resolver.isExcluded(".env.local")).toBe(true);
    expect(resolver.isExcluded("src/backend/api/users.ts")).toBe(false);
  });
});

describe("pathsMatch", () => {
  it("matches an item's own globs against a file", () => {
    expect(pathsMatch(["src/api/**"], "src/api/users.ts")).toBe(true);
    expect(pathsMatch(["src/api/**"], "src/app/page.tsx")).toBe(false);
    expect(pathsMatch([], "src/api/users.ts")).toBe(false);
  });
});
