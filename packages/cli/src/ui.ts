import type { Evidence, KnowledgeItem, KnowledgeStatusName } from "@chronicle/core";

const colorEnabled = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

function wrap(code: number, close = 39) {
  return (text: string): string => (colorEnabled ? `\u001B[${code}m${text}\u001B[${close}m` : text);
}

export const color = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31),
  green: wrap(32),
  yellow: wrap(33),
  blue: wrap(34),
  magenta: wrap(35),
  cyan: wrap(36),
  gray: wrap(90),
};

const ANSI = /\u001B\[[0-9;]*m/g;
export const visibleLength = (text: string): number => text.replace(ANSI, "").length;

export function statusBadge(status: KnowledgeStatusName): string {
  switch (status) {
    case "active":
      return color.green("active");
    case "confirmed":
      return color.cyan("confirmed");
    case "proposed":
      return color.yellow("proposed");
    case "stale":
      return color.red("stale");
    case "archived":
      return color.gray("archived");
  }
}

export function sourceBadge(source: string): string {
  return source === "human" ? color.cyan(source) : color.gray(source);
}

export function table(rows: readonly (readonly string[])[]): string {
  if (rows.length === 0) return "";
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, visibleLength(cell));
    });
  }
  return rows
    .map((row) =>
      row
        .map((cell, index) =>
          index === row.length - 1 ? cell : cell + " ".repeat((widths[index] ?? 0) - visibleLength(cell)),
        )
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

/**
 * A ULID's first 10 characters are a timestamp, so a short id has to reach into
 * the random suffix to stay distinguishable between items created together.
 */
export function shortId(id: string): string {
  const [prefix = "", body = ""] = id.split("_");
  return `${prefix}_${body.slice(0, 14)}`;
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "unknown";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function describeEvidence(evidence: Evidence): string {
  const expectation = evidence.expect === "absent" ? "expects absent" : "expects present";
  switch (evidence.kind) {
    case "file":
      return `file ${evidence.path} (${expectation})`;
    case "glob":
      return `glob ${evidence.glob} (${expectation})`;
    case "grep":
      return `grep /${evidence.pattern}/ in ${evidence.glob} (${expectation})`;
    case "commit":
      return `commit ${evidence.sha} (${expectation})`;
    case "ref":
      return `ref ${evidence.label ? `${evidence.label} — ` : ""}${evidence.url}`;
  }
}

function evidenceResult(evidence: Evidence): string {
  if (!evidence.lastResult || evidence.lastResult === "unknown") return color.gray("unchecked");
  if (evidence.lastResult === "pass") return color.green("pass");
  if (evidence.lastResult === "fail") return color.red("fail");
  return color.yellow("error");
}

export function formatListRow(item: KnowledgeItem): readonly string[] {
  return [
    statusBadge(item.status),
    color.magenta(item.type),
    item.title,
    color.gray(item.scopes.join(", ")),
    color.gray(shortId(item.id)),
  ];
}

export function formatDetail(item: KnowledgeItem): string {
  const lines: string[] = [];
  lines.push(color.bold(item.title));
  lines.push(color.gray(item.id));
  lines.push("");

  const facts: string[][] = [
    ["type", color.magenta(item.type)],
    ["status", statusBadge(item.status)],
    ["scopes", item.scopes.join(", ")],
    ["source", sourceBadge(item.source)],
    ["confidence", item.confidence.toFixed(2)],
    ["priority", String(item.priority)],
    ["lifetime", item.lifetime + (item.expiresAt ? ` (expires ${item.expiresAt.slice(0, 10)})` : "")],
    ["verified", relativeTime(item.lastVerifiedAt)],
    ["updated", relativeTime(item.updatedAt)],
    ["author", `${item.actor.id} (${item.actor.kind})`],
  ];
  if (item.paths.length) facts.push(["paths", item.paths.join(", ")]);
  if (item.tags.length) facts.push(["tags", item.tags.join(", ")]);
  if (item.type === "rule") facts.push(["enforcement", item.enforcement]);
  if (item.type === "decision") facts.push(["decision", item.decisionStatus]);
  if (item.type === "issue") facts.push(["severity", item.severity]);
  if (item.supersedes.length) facts.push(["supersedes", item.supersedes.map(shortId).join(", ")]);
  if (item.relatedTo.length) facts.push(["related", item.relatedTo.map(shortId).join(", ")]);
  facts.push(["provenance", `${item.provenance.origin}${item.provenance.ref ? ` — ${item.provenance.ref}` : ""}`]);

  lines.push(table(facts.map(([label, value]) => [color.gray(String(label)), String(value)])));

  if (item.body.trim()) {
    lines.push("");
    lines.push(item.body.trim());
  }

  if (item.evidence.length) {
    lines.push("");
    lines.push(color.bold("Evidence"));
    lines.push(
      table(
        item.evidence.map((evidence) => [
          `  ${evidenceResult(evidence)}`,
          describeEvidence(evidence),
          color.gray(evidence.lastCheckedAt ? relativeTime(evidence.lastCheckedAt) : ""),
        ]),
      ),
    );
  }

  lines.push("");
  lines.push(
    color.gray(
      `Actions: chronicle show ${shortId(item.id)} · chronicle verify ${shortId(item.id)} · chronicle archive ${shortId(item.id)} · chronicle history --item ${shortId(item.id)}`,
    ),
  );
  return lines.join("\n");
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function print(text = ""): void {
  process.stdout.write(`${text}\n`);
}
