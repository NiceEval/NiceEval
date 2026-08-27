---
name: feedback
description: Audit, migrate, or maintain existing NiceEval Feedback records and their legacy relations. Do not use for new observations; use the Issue skill instead.
metadata:
  command: pnpm feedback
  design: docs/engineering/feedback-memory/README.md
---

# Feedback

Read the [legacy Feedback and Memory design](../../../docs/engineering/feedback-memory/README.md#legacy-feedback) before changing an existing Feedback state or relationship. Run `pnpm feedback --help` for the current syntax.

Feedback is a retained Git owner for records that already exist. Use this skill to list, show, export, check, migrate, or repair those records and their current relationships. Do not run `add` or `import` to create a new Observation owner. Prepare a public sanitized Issue through the Issue skill instead; suspected vulnerabilities still go to Private Vulnerability Reporting.

Preserve the stored observation and provenance. Do not rewrite it into an inferred root cause or physically merge duplicate history. For an existing record, use `adopt` only when the observation is represented by an exact current Roadmap, Feature, Use Case, or Engineering contract. Use `retire` when that exact ref stops being current; never edit adoption history by hand.

Create or link a Memory when legacy investigation produces a Problem, Decision, or reusable Insight. Close an existing Feedback only with the evidence required by the legacy design. A local Feedback mutation never authorizes or synchronizes a remote Issue mutation.

Use `check` after mutations and include the changed Feedback directory in explicit Git paths. If a read reports `TraceRecoveryRequired`, do not inspect the owner directly; run `pnpm run repo docs trace recover` and retry the public command.
