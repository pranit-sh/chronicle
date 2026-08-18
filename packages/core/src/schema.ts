import { z } from "zod";

/**
 * The single source of truth for every Chronicle data shape. The CLI, the MCP
 * server and the future VS Code extension all validate through these schemas,
 * and the MCP tool definitions reuse them directly as `inputSchema`.
 */

export const KNOWLEDGE_TYPES = [
  "rule",
  "decision",
  "architecture",
  "domain",
  "convention",
  "context",
  "issue",
] as const;
export type KnowledgeTypeName = (typeof KNOWLEDGE_TYPES)[number];
export const KnowledgeTypeSchema = z.enum(KNOWLEDGE_TYPES);

/** Directory under `.chronicle/knowledge/` that holds each type. */
export const TYPE_DIRECTORIES: Record<KnowledgeTypeName, string> = {
  rule: "rules",
  decision: "decisions",
  architecture: "architecture",
  domain: "domain",
  convention: "conventions",
  context: "context",
  issue: "issues",
};

export const KNOWLEDGE_STATUSES = ["proposed", "confirmed", "active", "stale", "archived"] as const;
export type KnowledgeStatusName = (typeof KNOWLEDGE_STATUSES)[number];
export const KnowledgeStatusSchema = z.enum(KNOWLEDGE_STATUSES);

export const KNOWLEDGE_LIFETIMES = ["permanent", "long_term", "feature", "task", "temporary"] as const;
export type KnowledgeLifetimeName = (typeof KNOWLEDGE_LIFETIMES)[number];
export const KnowledgeLifetimeSchema = z.enum(KNOWLEDGE_LIFETIMES);

/** Lifetimes that describe knowledge which is expected to stop being true. */
export const EXPIRING_LIFETIMES: readonly KnowledgeLifetimeName[] = ["feature", "task", "temporary"];

export const KNOWLEDGE_SOURCES = ["human", "ai", "observed", "imported"] as const;
export type KnowledgeSourceName = (typeof KNOWLEDGE_SOURCES)[number];
export const KnowledgeSourceSchema = z.enum(KNOWLEDGE_SOURCES);

export const ULID_PATTERN = "[0-9A-HJKMNP-TV-Z]{26}";
export const KnowledgeIdSchema = z
  .string()
  .regex(new RegExp(`^k_${ULID_PATTERN}$`), "knowledge ids look like k_<ULID>");
export const ProposalIdSchema = z
  .string()
  .regex(new RegExp(`^pr_${ULID_PATTERN}$`), "proposal ids look like pr_<ULID>");

/**
 * Scopes are dotted paths such as `backend.api.auth`. An item scoped `backend`
 * applies to anything resolving under `backend.*`.
 */
export const SCOPE_PATTERN = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/;
export const ScopeIdSchema = z
  .string()
  .regex(SCOPE_PATTERN, "scopes are dot separated lowercase segments, e.g. backend.api");

/** The implicit root every other scope inherits from. */
export const ROOT_SCOPE = "project";

/**
 * YAML parsers can hand back `Date` instances for unquoted timestamps, so
 * normalise before validating.
 */
export const IsoDateSchema = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString() : value),
  z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "must be an ISO-8601 date or date-time",
  }),
);

export const ActorSchema = z.object({
  kind: z.enum(["human", "agent", "system"]),
  id: z.string().min(1),
});
export type Actor = z.infer<typeof ActorSchema>;

export const PROVENANCE_ORIGINS = ["manual", "command", "conversation", "scan", "import"] as const;
export const ProvenanceSchema = z.object({
  origin: z.enum(PROVENANCE_ORIGINS).default("manual"),
  ref: z.string().optional(),
  note: z.string().optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

// --- Evidence -------------------------------------------------------------

export const EvidenceExpectationSchema = z.enum(["present", "absent"]);
export const EvidenceResultSchema = z.enum(["pass", "fail", "error", "unknown"]);
export type EvidenceResultName = z.infer<typeof EvidenceResultSchema>;

const evidenceBase = z.object({
  expect: EvidenceExpectationSchema.default("present"),
  /** Optional bounds applied to the match count when `expect` is "present". */
  minMatches: z.number().int().nonnegative().optional(),
  maxMatches: z.number().int().nonnegative().optional(),
  note: z.string().optional(),
  lastCheckedAt: IsoDateSchema.optional(),
  lastResult: EvidenceResultSchema.optional(),
  lastDetail: z.string().optional(),
});

export const FileEvidenceSchema = evidenceBase.extend({
  kind: z.literal("file"),
  path: z.string().min(1),
});

export const GlobEvidenceSchema = evidenceBase.extend({
  kind: z.literal("glob"),
  glob: z.string().min(1),
});

export const GrepEvidenceSchema = evidenceBase.extend({
  kind: z.literal("grep"),
  glob: z.string().min(1).default("**/*"),
  pattern: z.string().min(1),
  flags: z.string().regex(/^[gimsuy]*$/).optional(),
});

export const CommitEvidenceSchema = evidenceBase.extend({
  kind: z.literal("commit"),
  sha: z.string().min(4),
});

/** Informational only: recorded for humans, never machine verified. */
export const RefEvidenceSchema = evidenceBase.extend({
  kind: z.literal("ref"),
  url: z.string().min(1),
  label: z.string().optional(),
});

export const EvidenceSchema = z.discriminatedUnion("kind", [
  FileEvidenceSchema,
  GlobEvidenceSchema,
  GrepEvidenceSchema,
  CommitEvidenceSchema,
  RefEvidenceSchema,
]);
export type Evidence = z.infer<typeof EvidenceSchema>;
export type EvidenceKind = Evidence["kind"];

/** Evidence kinds the deterministic verifier knows how to re-check. */
export const VERIFIABLE_EVIDENCE_KINDS: readonly EvidenceKind[] = ["file", "glob", "grep", "commit"];

// --- Knowledge items ------------------------------------------------------

const knowledgeBase = z.object({
  id: KnowledgeIdSchema,
  title: z.string().min(1).max(200),
  status: KnowledgeStatusSchema.default("active"),
  lifetime: KnowledgeLifetimeSchema.default("permanent"),
  expiresAt: IsoDateSchema.nullish(),
  scopes: z.array(ScopeIdSchema).default([ROOT_SCOPE]),
  paths: z.array(z.string().min(1)).default([]),
  tags: z.array(z.string().min(1)).default([]),
  source: KnowledgeSourceSchema.default("human"),
  confidence: z.number().min(0).max(1).default(0.8),
  priority: z.number().int().min(0).max(100).default(50),
  /** Exempt from the context budget whenever the item is in scope. */
  pinned: z.boolean().default(false),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  lastVerifiedAt: IsoDateSchema.nullish(),
  actor: ActorSchema,
  supersedes: z.array(KnowledgeIdSchema).default([]),
  relatedTo: z.array(KnowledgeIdSchema).default([]),
  provenance: ProvenanceSchema.default({ origin: "manual" }),
  evidence: z.array(EvidenceSchema).default([]),
});

export const RULE_ENFORCEMENTS = ["must", "should", "never"] as const;
export const RuleFrontmatterSchema = knowledgeBase.extend({
  type: z.literal("rule"),
  enforcement: z.enum(RULE_ENFORCEMENTS).default("must"),
});

export const DECISION_STATUSES = ["proposed", "accepted", "superseded", "rejected"] as const;
export const DecisionFrontmatterSchema = knowledgeBase.extend({
  type: z.literal("decision"),
  decisionStatus: z.enum(DECISION_STATUSES).default("accepted"),
  supersededBy: KnowledgeIdSchema.nullish(),
});

export const ArchitectureFrontmatterSchema = knowledgeBase.extend({
  type: z.literal("architecture"),
  stack: z.array(z.string().min(1)).default([]),
});

export const DomainFrontmatterSchema = knowledgeBase.extend({
  type: z.literal("domain"),
});

export const ConventionFrontmatterSchema = knowledgeBase.extend({
  type: z.literal("convention"),
});

export const ContextFrontmatterSchema = knowledgeBase.extend({
  type: z.literal("context"),
  lifetime: KnowledgeLifetimeSchema.default("temporary"),
});

export const ISSUE_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const IssueFrontmatterSchema = knowledgeBase.extend({
  type: z.literal("issue"),
  severity: z.enum(ISSUE_SEVERITIES).default("medium"),
  workaround: z.string().optional(),
});

const knowledgeFrontmatterUnion = z.discriminatedUnion("type", [
  RuleFrontmatterSchema,
  DecisionFrontmatterSchema,
  ArchitectureFrontmatterSchema,
  DomainFrontmatterSchema,
  ConventionFrontmatterSchema,
  ContextFrontmatterSchema,
  IssueFrontmatterSchema,
]);

export const KnowledgeFrontmatterSchema = knowledgeFrontmatterUnion.superRefine((value, ctx) => {
  if (EXPIRING_LIFETIMES.includes(value.lifetime) && !value.expiresAt) {
    ctx.addIssue({
      code: "custom",
      path: ["expiresAt"],
      message: `lifetime "${value.lifetime}" requires an expiresAt date`,
    });
  }
  if (value.supersedes.includes(value.id)) {
    ctx.addIssue({ code: "custom", path: ["supersedes"], message: "an item cannot supersede itself" });
  }
  if (value.scopes.length === 0) {
    ctx.addIssue({ code: "custom", path: ["scopes"], message: "at least one scope is required" });
  }
});

export type KnowledgeFrontmatter = z.infer<typeof KnowledgeFrontmatterSchema>;

/** Conventional H2 headings pulled out of a decision body. */
export const DECISION_SECTIONS = ["decision", "rationale", "alternatives", "consequences"] as const;

/**
 * A knowledge item as the store hands it back: validated frontmatter plus the
 * Markdown body, its extracted sections, and where it lives on disk.
 */
export type KnowledgeItem = KnowledgeFrontmatter & {
  body: string;
  sections: Record<string, string>;
  /** Absolute path of the Markdown file backing this item. */
  filePath: string;
};

// --- Drafts ---------------------------------------------------------------

/**
 * The loose shape callers supply when creating or proposing an item. The store
 * fills in ids, timestamps and defaults, then validates the result against
 * {@link KnowledgeFrontmatterSchema}.
 */
export const KnowledgeDraftSchema = z.object({
  type: KnowledgeTypeSchema,
  title: z.string().min(1).max(200),
  body: z.string().default(""),
  status: KnowledgeStatusSchema.optional(),
  lifetime: KnowledgeLifetimeSchema.optional(),
  expiresAt: IsoDateSchema.nullish(),
  scopes: z.array(ScopeIdSchema).optional(),
  paths: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional(),
  source: KnowledgeSourceSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  pinned: z.boolean().optional(),
  supersedes: z.array(KnowledgeIdSchema).optional(),
  relatedTo: z.array(KnowledgeIdSchema).optional(),
  provenance: ProvenanceSchema.optional(),
  evidence: z.array(EvidenceSchema).optional(),
  enforcement: z.enum(RULE_ENFORCEMENTS).optional(),
  decisionStatus: z.enum(DECISION_STATUSES).optional(),
  severity: z.enum(ISSUE_SEVERITIES).optional(),
  workaround: z.string().optional(),
  stack: z.array(z.string().min(1)).optional(),
});
export type KnowledgeDraft = z.input<typeof KnowledgeDraftSchema>;

/** Fields a proposal is allowed to change on an existing item. */
export const UPDATABLE_FIELDS = [
  "title",
  "body",
  "status",
  "lifetime",
  "expiresAt",
  "scopes",
  "paths",
  "tags",
  "confidence",
  "priority",
  "pinned",
  "evidence",
  "supersedes",
  "relatedTo",
  "enforcement",
  "decisionStatus",
  "severity",
  "workaround",
  "stack",
] as const;
export type UpdatableField = (typeof UPDATABLE_FIELDS)[number];

// --- Proposals ------------------------------------------------------------

export const PROPOSAL_OPS = ["create", "update", "archive", "restore"] as const;
export const ProposalOpSchema = z.enum(PROPOSAL_OPS);
export type ProposalOp = z.infer<typeof ProposalOpSchema>;

export const FieldChangeSchema = z.object({
  before: z.unknown().optional(),
  after: z.unknown().optional(),
});
export type FieldChange = z.infer<typeof FieldChangeSchema>;

const proposalBase = z.object({
  id: ProposalIdSchema,
  op: ProposalOpSchema,
  targetId: KnowledgeIdSchema.optional(),
  proposedBy: ActorSchema,
  createdAt: IsoDateSchema,
  reason: z.string().min(1),
  changes: z.partialRecord(z.enum(UPDATABLE_FIELDS), FieldChangeSchema).optional(),
  payload: KnowledgeDraftSchema.optional(),
});

export const ProposalSchema = proposalBase.superRefine((value, ctx) => {
  if (value.op === "create") {
    if (!value.payload) {
      ctx.addIssue({ code: "custom", path: ["payload"], message: "create proposals need a payload" });
    }
    return;
  }
  if (!value.targetId) {
    ctx.addIssue({
      code: "custom",
      path: ["targetId"],
      message: `${value.op} proposals need a targetId`,
    });
  }
  if (value.op === "update" && (!value.changes || Object.keys(value.changes).length === 0)) {
    ctx.addIssue({ code: "custom", path: ["changes"], message: "update proposals need at least one change" });
  }
});
export type Proposal = z.infer<typeof ProposalSchema>;

// --- History --------------------------------------------------------------

export const HISTORY_OPS = [
  "init",
  "create",
  "update",
  "archive",
  "restore",
  "delete",
  "propose",
  "accept",
  "reject",
  "verify",
  "stale",
  "expire",
] as const;
export const HistoryOpSchema = z.enum(HISTORY_OPS);
export type HistoryOp = z.infer<typeof HistoryOpSchema>;

export const HistoryEventSchema = z.object({
  ts: IsoDateSchema,
  op: HistoryOpSchema,
  itemId: z.string().optional(),
  proposalId: z.string().optional(),
  actor: ActorSchema,
  summary: z.string(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
});
export type HistoryEvent = z.infer<typeof HistoryEventSchema>;

// --- Config ---------------------------------------------------------------

export const BudgetSchema = z.object({
  maxItems: z.number().int().positive().default(25),
  maxChars: z.number().int().positive().default(8000),
});
export type Budget = z.infer<typeof BudgetSchema>;

export const AuthoritySchema = z.object({
  /** Agents may stage new proposals. */
  autoLearn: z.boolean().default(true),
  /** Agents may propose changes to accepted rules and decisions. */
  autoModifyRules: z.boolean().default(false),
  /** `verify` may archive items whose evidence has vanished. */
  autoArchiveStale: z.boolean().default(false),
  detectContradictions: z.boolean().default(true),
});
export type Authority = z.infer<typeof AuthoritySchema>;

export const ResolverWeightsSchema = z.object({
  scopeSpecificity: z.number().default(3),
  typePriority: z.number().default(2),
  sourceAuthority: z.number().default(1.5),
  confidence: z.number().default(1),
  freshness: z.number().default(0.5),
  keyword: z.number().default(2.5),
  priority: z.number().default(1),
  pathMatch: z.number().default(2),
});
export type ResolverWeights = z.infer<typeof ResolverWeightsSchema>;

export const ResolverConfigSchema = z.object({
  weights: ResolverWeightsSchema.prefault({}),
  /** Stale items are surfaced with a warning rather than hidden outright. */
  includeStale: z.boolean().default(true),
  includeProposed: z.boolean().default(false),
  /** Days after which an unverified item's freshness score decays to zero. */
  freshnessHorizonDays: z.number().int().positive().default(90),
});
export type ResolverConfig = z.infer<typeof ResolverConfigSchema>;

export const DEFAULT_EXCLUDES = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.git/**",
  "**/.env*",
  "**/secrets/**",
  "**/*.pem",
  "**/*.key",
];

export const ChronicleConfigSchema = z.object({
  version: z.literal(1).default(1),
  /** Maps a scope id to the code paths that activate it. */
  scopes: z.record(ScopeIdSchema, z.array(z.string().min(1))).default({}),
  budget: BudgetSchema.prefault({}),
  authority: AuthoritySchema.prefault({}),
  resolver: ResolverConfigSchema.prefault({}),
  /** Paths the verifier never reads and the resolver never matches against. */
  exclude: z.array(z.string().min(1)).default(DEFAULT_EXCLUDES),
});
export type ChronicleConfig = z.infer<typeof ChronicleConfigSchema>;

export const DEFAULT_CONFIG: ChronicleConfig = ChronicleConfigSchema.parse({});
