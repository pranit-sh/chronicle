# Changelog

All notable changes to the Codicil extension are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-23

First public release.

### Added

- **Knowledge view** — everything the project knows, grouped by type, status or
  scope, with a live summary of how much is in play, stale or waiting on you.
- **Proposals view** — knowledge staged by agents, reviewed as a diff. Nothing
  reaches the knowledge base until you accept it.
- **Context view** — the exact package an agent would receive for the file you
  are editing, in the order it would see it, including what was dropped for the
  budget and why.
- **Guide view** — the Codicil workflow, available actions, verification check
  syntax and agent setup.
- Setup commands for the MCP server in Copilot, Cursor and Claude Code, plus a
  command to add Codicil instructions to your agent instruction files.
- Capture commands: **Remember this** and **Remember the selected text**, which
  infer type and scope from the sentence and show you the guess before saving.
- Verification commands to re-check stored knowledge against the code, per item
  or across the whole knowledge layer.
- **Doctor** command for merge conflicts, broken files and dangling references.
- Status bar entry showing how many knowledge items apply to the current file,
  toggled by `codicil.statusBar.enabled`.
- `codicil.groupBy` setting to group the knowledge tree by type, status or
  scope.

[0.1.0]: https://github.com/pranit-sh/codicil/releases/tag/v0.1.0
