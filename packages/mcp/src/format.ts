import {
  type Evidence,
  type KnowledgeItem,
  leadParagraph,
  truncate,
} from "@chronicle/core";

/**
 * Everything an agent reads comes back as plain Markdown. Models handle prose
 * far better than nested JSON, and a developer reading the MCP transcript can
 * see exactly what the agent was told.
 */

function describeEvidence(evidence: Evidence): string {
  const expectation = evidence.expect === "absent" ? "expected absent" : "expected present";
  const result = evidence.lastResult && evidence.lastResult !== "unknown" ? `, last check ${evidence.lastResult}` : "";
  switch (evidence.kind) {
    case "file":
      return `file \`${evidence.path}\` ${expectation}${result}`;
    case "glob":
      return `glob \`${evidence.glob}\` ${expectation}${result}`;
    case "grep":
      return `\`/${evidence.pattern}/\` in \`${evidence.glob}\` ${expectation}${result}`;
    case "commit":
      return `commit \`${evidence.sha}\` ${expectation}${result}`;
    case "ref":
      return `reference ${evidence.label ?? evidence.url}`;
  }
}

export function formatSearchHit(item: KnowledgeItem): string {
  const summary = truncate(leadParagraph(item.body), 160);
  const head = `- **${item.title}** — ${item.type}, ${item.status}, scope \`${item.scopes.join(", ")}\` \`${item.id}\``;
  return summary ? `${head}\n  ${summary}` : head;
}

export function formatItem(item: KnowledgeItem): string {
  const lines: string[] = [];
  lines.push(`# ${item.title}`);
  lines.push("");
  lines.push(`- id: \`${item.id}\``);
  lines.push(`- type: ${item.type}`);
  lines.push(`- status: ${item.status}`);
  lines.push(`- scopes: ${item.scopes.join(", ")}`);
  if (item.paths.length) lines.push(`- paths: ${item.paths.join(", ")}`);
  if (item.tags.length) lines.push(`- tags: ${item.tags.join(", ")}`);
  lines.push(`- source: ${item.source} (${item.actor.kind} ${item.actor.id})`);
  lines.push(`- confidence: ${item.confidence}`);
  lines.push(`- lifetime: ${item.lifetime}${item.expiresAt ? `, expires ${item.expiresAt.slice(0, 10)}` : ""}`);
  lines.push(`- last verified: ${item.lastVerifiedAt ? item.lastVerifiedAt.slice(0, 10) : "never"}`);
  lines.push(`- provenance: ${item.provenance.origin}${item.provenance.ref ? ` (${item.provenance.ref})` : ""}`);
  if (item.type === "rule") lines.push(`- enforcement: ${item.enforcement}`);
  if (item.type === "decision") lines.push(`- decision status: ${item.decisionStatus}`);
  if (item.type === "issue") lines.push(`- severity: ${item.severity}`);
  if (item.supersedes.length) lines.push(`- supersedes: ${item.supersedes.join(", ")}`);
  if (item.relatedTo.length) lines.push(`- related to: ${item.relatedTo.join(", ")}`);

  if (item.body.trim()) {
    lines.push("");
    lines.push(item.body.trim());
  }

  if (item.evidence.length) {
    lines.push("");
    lines.push("## Evidence");
    lines.push("");
    for (const evidence of item.evidence) lines.push(`- ${describeEvidence(evidence)}`);
  }

  if (item.status === "stale") {
    lines.push("");
    lines.push(
      "> This item is marked stale: its supporting evidence no longer holds. Treat it as unverified and raise it with the developer rather than acting on it.",
    );
  }

  return lines.join("\n");
}

export function textResult(text: string): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text }] };
}

export function errorResult(text: string): {
  content: [{ type: "text"; text: string }];
  isError: true;
} {
  return { content: [{ type: "text", text }], isError: true };
}
