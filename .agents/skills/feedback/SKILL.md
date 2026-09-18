---
name: feedback
description: Maintain current Concord Issue owners, closure and Memory relations. Do not use for new observations; use the Issue skill instead.
metadata:
  command: pnpm feedback
  design: docs/engineering/feedback-memory/README.md
---

# Feedback

Read the [Feedback and Memory design](../../../docs/engineering/feedback-memory/README.md#feedback) before changing an existing Feedback state or relationship. Run `pnpm feedback --help` for the current syntax.

Feedback is a local Issue owner at docs/issues/<id>.md using concord.document/v1. Use this skill to list, show, export, check, or repair those records and their current relationships. The public CLI has no `add` command. Use `import` only to recover an already-produced historical downstream envelope, never to create a new Observation owner. Prepare a public sanitized Issue through the Issue skill instead; suspected vulnerabilities still go to Private Vulnerability Reporting.

Preserve the stored observation and provenance. Do not rewrite it into an inferred root cause or physically merge duplicate history. For an existing record, use `adopt` only when the observation is represented by an exact current Roadmap, Feature, Use Case, or Engineering contract. Use `retire` when that exact ref stops being current; never edit adoption history by hand.

Create or link a Memory when investigation produces a Problem, Decision, or reusable Insight. Close an existing Feedback with `pnpm feedback close <id> --kind <kind>` and the kind-specific native fields: `--memory`, `--target`, repeatable `--proof`, `--canonical`, repeatable `--evidence`, `--dependency`, or `--version`. Do not assemble closure JSON; the command rejects missing fields and fields that belong to another kind. A local Feedback mutation never authorizes or synchronizes a remote Issue mutation.

Use `check` after mutations and include the changed docs/issues/<id>.md owner in explicit Git paths. If a read reports `TraceRecoveryRequired`, do not inspect the owner directly; run `pnpm run repo docs trace recover` and retry the public command.
