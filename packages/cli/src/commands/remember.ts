import {
  KNOWLEDGE_LIFETIMES,
  KNOWLEDGE_TYPES,
  RULE_ENFORCEMENTS,
  classifyStatement,
  defaultExpiry,
  type KnowledgeDraft,
} from "@chronicle/core";
import type { Command } from "commander";

import { collect, parseNumber } from "../options.js";
import { color, formatDetail, print, printJson, shortId } from "../ui.js";
import { type GlobalOptions, openStore, resolveActor } from "../workspace.js";

interface RememberOptions extends GlobalOptions {
  type?: string;
  scope?: string[];
  tag?: string[];
  path?: string[];
  enforcement?: string;
  severity?: string;
  priority?: string;
  confidence?: string;
  lifetime?: string;
  expires?: string;
  body?: string;
  pin?: boolean;
  dryRun?: boolean;
}

export function registerRemember(program: Command): void {
  program
    .command("remember")
    .description("Capture a piece of project knowledge as a structured item")
    .argument("<statement...>", "what the project should remember")
    .option("--type <type>", `force a type (${KNOWLEDGE_TYPES.join(", ")})`)
    .option("--scope <scope>", "scope this applies to, repeatable", collect, [])
    .option("--tag <tag>", "tag, repeatable", collect, [])
    .option("--path <glob>", "path glob this applies to, repeatable", collect, [])
    .option("--enforcement <level>", `rule strength (${RULE_ENFORCEMENTS.join(", ")})`)
    .option("--severity <level>", "issue severity (low, medium, high, critical)")
    .option("--priority <n>", "0-100, breaks ties inside the context budget")
    .option("--confidence <n>", "0-1")
    .option("--lifetime <lifetime>", `one of ${KNOWLEDGE_LIFETIMES.join(", ")}`)
    .option("--expires <date>", "ISO date after which this stops being supplied")
    .option("--body <text>", "longer explanation stored as the Markdown body")
    .option("--pin", "always include this item when it is in scope")
    .option("--dry-run", "show what would be written without writing it")
    .action(async function (this: Command, statement: string[]) {
      const options = this.optsWithGlobals<RememberOptions>();
      const store = await openStore(options);
      const actor = await resolveActor(options);

      const text = statement.join(" ").trim();
      const knownScopes = Object.keys(store.config.scopes);
      const classified = classifyStatement(text, knownScopes);

      const type = (options.type as KnowledgeDraft["type"] | undefined) ?? classified.type;
      const lifetime = (options.lifetime as KnowledgeDraft["lifetime"]) ?? classified.lifetime;
      const needsExpiry = lifetime === "temporary" || lifetime === "task" || lifetime === "feature";

      const draft: KnowledgeDraft = {
        type,
        title: classified.title,
        body: options.body ?? classified.body,
        source: "human",
        confidence: parseNumber(options.confidence, "confidence") ?? 0.9,
        scopes: options.scope?.length ? options.scope : classified.scopes,
        provenance: { origin: "command", ref: "chronicle remember" },
      };
      if (options.tag?.length) draft.tags = options.tag;
      if (options.path?.length) draft.paths = options.path;
      if (options.priority !== undefined) draft.priority = parseNumber(options.priority, "priority");
      if (options.pin) draft.pinned = true;
      if (lifetime) draft.lifetime = lifetime;
      if (options.expires) draft.expiresAt = options.expires;
      else if (needsExpiry) draft.expiresAt = defaultExpiry();
      if (type === "rule") {
        draft.enforcement =
          (options.enforcement as KnowledgeDraft["enforcement"]) ?? classified.enforcement ?? "must";
      }
      if (type === "issue" && options.severity) {
        draft.severity = options.severity as KnowledgeDraft["severity"];
      }

      if (options.dryRun) {
        if (options.json) printJson({ draft, classifiedAs: classified.type, reason: classified.reason });
        else {
          print(color.yellow("Dry run, nothing written."));
          print(`Would file as ${color.magenta(String(draft.type))} because it ${classified.reason}.`);
          print(JSON.stringify(draft, null, 2));
        }
        return;
      }

      const item = await store.create(draft, actor);

      if (options.json) {
        printJson({ item, classifiedAs: classified.type, reason: classified.reason });
        return;
      }

      print(`${color.green("Remembered")} as ${color.magenta(item.type)} ${color.gray(shortId(item.id))}`);
      if (!options.type) print(color.gray(`Classified as ${item.type} because it ${classified.reason}.`));
      print();
      print(formatDetail(item));
    });
}
