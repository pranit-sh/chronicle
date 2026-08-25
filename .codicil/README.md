# Codicil knowledge layer

This directory is the project's knowledge layer: what the project believes, why,
where it applies, and whether it is still true. It is committed to Git on
purpose, so knowledge follows branches exactly like code does.

## Layout

- `config.yaml` — scope map, context budget, and what agents may do unattended.
- `knowledge/` — one Markdown file per item, grouped by type. The Markdown is
  the source of truth; edit it by hand whenever you like.
- `proposals/` — staged changes awaiting review. AI agents may write here, and
  nowhere else. Review them with `codicil proposals`.
- `archive/` — items kept for history but no longer supplied to agents.
- `history/` — an append-only changelog, one JSONL file per day.
- `.cache/` — derived index, gitignored, safe to delete.

## Everyday commands

```
codicil remember "Never call the DB directly from API handlers"
codicil context --file src/api/users.ts --task "add pagination"
codicil proposals
codicil verify
```
