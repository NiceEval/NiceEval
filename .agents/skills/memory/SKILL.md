---
name: memory
description: Record, search, resolve, reopen, supersede, promote, or retire NiceEval development problems, decisions, and reusable insights.
metadata:
  command: pnpm memory
  design: docs/engineering/feedback-memory/README.md
---

# Memory

Read the [Memory design](../../../docs/engineering/feedback-memory/README.md#memory) before changing structured Memory state. Run `pnpm memory --help` for current syntax.

Use Problem for a reproducible problem and its root cause, Decision for an adopted choice, and Insight for know-how that remains useful without a problem lifecycle. Search existing Memory first. Do not create Feedback merely to justify a Memory.

Use native CLI fields instead of assembling metadata or resolution JSON. Create with `pnpm memory add <id> --title <title> --kind <problem|decision|insight> --body <markdown>`; `--created-at` is optional. Resolve with `pnpm memory resolve <id> --kind <kind> --proof <receipt>`, repeating `--proof` for each independent receipt.

Resolve a product Problem as fixed only after the public-entry E2E regression gate passes. Promote a conclusion by linking to the exact current Roadmap, Feature, Use Case, or Engineering target; Memory remains historical evidence and never replaces the target contract. Use `retire` when an exact promotion stops being current, and never edit promotion history by hand.

Legacy unstructured Memory is searchable and referenceable but read-only. Run `check` after mutations and include only the changed Memory files in explicit Git paths. If a read reports `TraceRecoveryRequired`, do not inspect the owner directly; run `pnpm run repo docs trace recover` and retry the public command.
