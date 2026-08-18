# Context Layer + Knowledge Git (Chronicle)

## 1. Overview
A developer tool (initially a VS Code extension) giving AI coding agents a **persistent, structured, visible, developer-controlled** understanding of a project — not a hidden/flat memory, but an explicit, hierarchical, versioned knowledge layer AI can read, update, validate, and use as context. Combines two ideas:
- **Context Layer** — determines what project knowledge is relevant to the current task/code.
- **Knowledge Git** — treats knowledge as proposable, reviewable, versioned, able to go stale, and archivable.

Not just another `memory.md`.

## 2. Problem
Project knowledge (conventions, architecture decisions, domain rules, constraints, known issues, "never do X," rationale) is scattered across code, READMEs, comments, docs, issues/PRs, `AGENTS.md`/`CLAUDE.md`/`.instructions.md`, conversations, and developers' heads. AI agents keep rediscovering it — or worse, keep applying **outdated** facts (e.g., "Use Zustand" long after a migration to Redux). The system needs not just memory but **provenance, scope, state, validation, and lifecycle**.

## 3. Core Thesis
Frame it as **"a versioned, developer-controlled context layer for AI coding agents"** — not "an AI memory file." It should track: what the project believes, why, where the knowledge came from, where it applies, confidence, whether it's still true, who/what changed it, and what an AI should receive for the current task.

## 4. High-Level Architecture
```
Project → Project Knowledge Layer → Context Resolution Engine
   → ("what matters for this task?") → Copilot / Claude / Codex (agent-agnostic)
```

## 5. Project Knowledge Model
Knowledge is **hierarchical**, not a flat list:
```
Architecture (Backend/API, Auth, Services; Frontend/State, Components; Infrastructure)
Rules (General, Backend, Frontend, Testing)
Decisions (Database, Authentication, API Design, Infrastructure)
Domain (Users, Organizations, Payments, Products)
Conventions
Current Context
Known Issues
Temporary Knowledge
```
Knowledge inherits by scope: editing `src/backend/api/auth/login.ts` pulls Project + Backend + API + Authentication knowledge, without unrelated frontend info.

## 6. Knowledge Types
- **Rules** — explicit instructions with strong priority (e.g., "Never edit `generated/openapi/*`"; "All API validation uses Zod").
- **Decisions** — architectural choices with rationale, alternatives considered, and status (e.g., PostgreSQL chosen over MongoDB for relational data + transactions). Rationale matters so AI doesn't accidentally reverse decisions.
- **Architecture** — structural facts (stack: Next.js, Fastify, PostgreSQL, Better Auth, Docker+AWS).
- **Domain Knowledge** — business concepts (e.g., an Organization has one owner, multiple Users/Projects) — often absent from code.
- **Conventions** — recurring patterns (thin handlers, repository DB access, Vitest, kebab-case files); may start as AI-inferred.
- **Current Context** — temporary state (e.g., "auth mid-migration to Better Auth, old JWT code still present") — shorter lifecycle than rules.
- **Known Issues** — things to watch for (e.g., uploads >10MB occasionally timeout; workaround: multipart streaming).

## 7. Human vs AI vs Observed Knowledge
Knowledge carries a source tag: **Human, AI, Observed, Imported**. E.g., a human directive ("Never use Prisma") differs in authority from an AI inference ("responses seem to follow `Result<T,E>`") or an observation ("all DB calls go through repositories"). Sources must be visible in the UI; AI-inferred facts don't auto-promote to rules.

## 8. Knowledge Lifecycle
```
PROPOSED → CONFIRMED → ACTIVE → STALE → ARCHIVED
```
- Proposed: AI-detected, unconfirmed. Confirmed: developer accepted. Active: currently valid. Stale: evidence suggests invalidity. Archived: kept for history, not normally supplied to agents.

## 9. Provenance
Every item should answer "why does the AI believe this?" via metadata: created date, source (e.g., a specific conversation), related code, creator (human/AI), confidence score, last-verified date.

## 10. Evidence
Knowledge can cite supporting evidence — files, commits, PRs, config, tests, docs (e.g., "18/18 API endpoints use Zod, per src/api/users.ts, payments.ts, auth.ts") — used to assess continued validity.

## 11. Staleness Detection
Key differentiator: flag knowledge whose supporting evidence has vanished (e.g., a "use Zustand" rule with 0 recent references while Redux appears in 23 files, last verified 91 days ago). System offers **Update / Keep / Archive** — never silently overwrites.

## 12. Contradiction Detection
Detects conflicts between stored knowledge and current repo state (e.g., stored "Auth uses JWT" vs. 31 files showing Better Auth). Presents **Update / Keep Existing / Investigate**.

## 13. Knowledge Diff
A Git-like diff view for proposed knowledge changes (`+` additions, `~` modifications, `-` removals), reviewable with **Accept / Reject / Edit / Accept selected**. AI proposes rather than silently mutates knowledge.

## 14. Knowledge History
Git-like changelog per day (Added/Updated/Archived entries), with future support for **view history, compare versions, revert, inspect source, see who/what changed it**.

## 15. Context Resolution
Given a current file (and optionally a task description), the engine resolves only relevant knowledge — e.g., for `src/payments/stripe/webhook.ts`, it pulls payments/Stripe rules, error-handling conventions, and current migration context, while excluding frontend/mobile/analytics knowledge. Goal: context that is **relevant, not merely available**.

## 16. Context Scope
Knowledge items carry one or more scopes: `project, backend, frontend, payments, authentication, file, directory, feature`. Rules can be global ("Use TypeScript"), local ("Backend/API errors use AppError"), or narrow ("payments/stripe: never auto-retry webhooks") — enabling hierarchical inheritance.

## 17. Context Resolution Inputs
Signals the resolver can use: current file, current directory, open files, Git branch, current task, selected code, recent conversation, project structure, knowledge scope/status/relevance — combined into a compact context package.

## 18. Agent Integration
Should become agent-agnostic (VS Code Copilot, Claude Code, Codex, Cursor, Gemini, custom agents), via `Project Knowledge → Context Resolver → Agent Adapter → AI Agent`. Delivery mechanism (MCP, generated instruction files, API, extension APIs) is undecided.

## 19. VS Code UX
Sidebar tree mirroring the knowledge hierarchy (Architecture, Rules, Decisions, Domain, Conventions, Current Context, Known Issues), with a status summary (e.g., "12 active · 3 proposed · 2 stale").

## 20. Knowledge Detail View
Clicking an item shows: type, status, scope, source, confidence, last-verified date, evidence files, reasoning, and actions (**Edit / Archive / View Evidence / View History**).

## 21. `/remember`
Explicit command to add knowledge, e.g. `/remember Never directly access the database from API handlers` → converted into a structured rule under Rules → Backend, editable before acceptance.

## 22. Automatic Knowledge Suggestions
AI observes conversations/code activity and proposes additions (e.g., detecting "let's use Redis for rate limiting" → suggests an Infrastructure entry; detecting "don't modify generated/openapi" → suggests a rule), each with **Add / Edit / Ignore** — helpful without being noisy.

## 23. Principle: Do Not Learn Everything
The AI must distinguish temporary statements, preferences, experiments, suggestions, decisions, rules, and facts. A tentative remark ("maybe we should try Redis") should NOT become a permanent Decision; an explicit statement ("we've decided to use Redis for rate limiting") can become a proposed one.

## 24. Temporary vs Permanent Context
Some knowledge should expire (e.g., "migrating auth — expires after migration completes"). Categories: Permanent, Long-term, Feature-level, Task-level, Temporary — so short-lived info doesn't pollute long-term knowledge.

## 25. Local-First Architecture
MVP should be local-first, stored in-project (e.g., `.chronicle/knowledge/`, `.chronicle/history/`, `.chronicle/.cache/`, `.chronicle/config.yaml`; exact format TBD). Core principle: **the developer owns the knowledge** — no cloud dependency required for basic use.

## 26. Git Integration
Knowledge should live alongside code in Git (commit, branch, merge), so different branches can hold different knowledge states — i.e., **knowledge follows the codebase's Git state**.

## 27. Knowledge Merge Conflicts
Branches can disagree (e.g., `main`: JWT auth vs. `feature/better-auth`: Better Auth), surfaced as a conflict with a **[Resolve]** action — the point where "Knowledge Git" becomes literal.

## 28. AI Authority Levels
Tiered autonomy: **Safe** (AI can auto-create suggestions), **Medium** (AI can update inferred observations), **High-risk** (architectural rules need human approval). Configurable toggles: Auto-learn, Auto-modify rules, Auto-archive stale knowledge, Detect contradictions.

## 29. Security and Trust
Since project knowledge can be sensitive, the system should: default to local storage, show exactly what context is sent to AI, avoid storing secrets/credentials, support exclusion rules, allow deletion/inspection of knowledge, and eventually offer a **Context Preview** before sending.

## 30. Example Scenario: Normal Use
Opening `src/payments/stripe/webhook.ts` auto-surfaces payments/Stripe architecture, relevant rules (validate signatures, no direct DB writes, use AppError), and current migration context. Asking the AI to "refactor this webhook" resolves exactly that context automatically — no need to repeat conventions manually.

## 31. Example Scenario: Stale Knowledge
Stored "Database: MongoDB" becomes inconsistent once the repo shows Prisma/PostgreSQL and zero MongoDB references. System flags it as stale (last verified 128 days ago) and offers **Update / Archive / Investigate**.

## 32. What the Product Is NOT
Not: a generic RAG platform, a documentation generator, a Git replacement, a chatbot, or a massive knowledge graph. Git remains the source-control system; Knowledge Git is a conceptual versioning layer for knowledge, not a replacement for Git; internal representation stays simple until usage demands more.

## 33. MVP Components
1. VS Code Extension (UI)
2. Local Knowledge Store
3. Knowledge Tree (Rules, Architecture, Decisions, Domain, Context, Issues)
4. `/remember` command
5. AI Suggestions
6. Knowledge Status (Proposed/Active/Stale/Archived)
7. Context Resolver (file/task → relevant knowledge)
8. One AI integration to start
9. Knowledge Diff before applying changes

## 34. MVP User Experience
Flow: developer says "remember that we never call the DB directly from API routes" → AI proposes a structured Backend/API rule → developer clicks Accept → it appears in the Knowledge Tree. Later, opening `src/api/users.ts` auto-resolves Project + Backend + API rules and relevant decisions for the AI.

## 35. Long-Term Vision
> Every serious software project has an explicit, evolving knowledge layer that AI agents understand and developers can inspect/control.
Future features: multi-agent shared knowledge, knowledge analytics, automatic architecture maps, commit- and PR-aware updates, team collaboration, review workflows, ownership, confidence scoring, contradiction detection, automatic evidence collection, snapshots, branch-aware knowledge, org-wide policies, an MCP server, GitHub/GitLab integration, and support beyond VS Code.

## 36. Key Differentiators
1. **Visible** — developers see what AI believes.
2. **Hierarchical** — scoped, inheriting knowledge.
3. **Provenance-aware** — traceable origins.
4. **Versioned** — reviewable/revertible changes.
5. **Evidence-based** — checkable against the repo.
6. **Context-aware** — only relevant knowledge is supplied.
7. **Developer-controlled** — AI suggests, doesn't silently rewrite.
8. **Agent-agnostic** — usable across multiple coding agents.

## 37. Core Product Statement
> **Context Layer + Knowledge Git is a developer-controlled, versioned knowledge layer for AI coding agents. It continuously captures important project rules, decisions, architecture, domain knowledge, and temporary context; organizes them hierarchically; tracks their provenance and lifecycle; detects stale or conflicting knowledge; and resolves only the relevant context for the code and task an AI agent is currently working on.**

## 38. Working Product Name
No final name yet — currently referred to as **Context Layer + Knowledge Git**, to be decided post-MVP.

## 39. Current Product Direction
```
Context Layer + Knowledge Git → Developer-controlled AI project context
```
Core hypothesis to validate: **does giving developers a visible, structured, versioned, evidence-backed way to control what AI knows about their project meaningfully improve coding-agent reliability and developer trust?**

## 40. Design Principle
Don't optimize for "how much information can we give the AI?" Optimize for **"what is the smallest amount of correct, relevant project knowledge the AI needs for this task?"** — this should drive the context-resolution architecture, UX, storage model, and future integrations.

## 41. Current Status
Idea/exploration stage, not yet implemented. Next steps:
1. Refine concept/positioning
2. Explore competitors and existing IDE capabilities
3. Identify the strongest differentiated workflow
4. Design VS Code UX
5. Define the knowledge data model
6. Define the context-resolution algorithm
7. Decide AI integration mechanism(s)
8. Build a small MVP
9. Test whether developers actually use/trust it
10. Expand only around validated behavior