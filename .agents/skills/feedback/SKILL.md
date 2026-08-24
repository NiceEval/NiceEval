---
name: feedback
description: Record, import, investigate, relate, adopt, retire, close, or reopen NiceEval feedback originating from issues, dogfooding, or development.
metadata:
  command: pnpm feedback
  design: docs/engineering/feedback-memory/README.md
---

# Feedback

Read the [Feedback and Memory design](../../../docs/engineering/feedback-memory/README.md#feedback) before changing feedback state or relationships. Run `pnpm feedback --help` for the current syntax.

Preserve the reporter's observation and provenance. Classify source, subject, and claim independently; do not rewrite an observation into an inferred root cause. Search for duplicates before adding, but retain each imported record and relate duplicates instead of merging their history.

Use `adopt` only when the observation is represented by an exact current Roadmap, Feature, Use Case, or Engineering contract. Use `retire` for that exact ref when it stops being current; never edit adoption history by hand.

Create or link a Memory when investigation produces a problem, decision, or reusable insight. Close Feedback only with the closure kind and evidence required by the design; remote issue changes need explicit user authorization and are not implied by a local close.

Use `check` after mutations and include the changed Feedback directory in explicit Git paths. If a read reports `TraceRecoveryRequired`, do not inspect the owner directly; run `pnpm trace recover` and retry the public command.
