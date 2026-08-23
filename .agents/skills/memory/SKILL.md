---
name: memory
description: Record, search, resolve, supersede, or promote NiceEval development problems, decisions, and reusable insights.
metadata:
  command: pnpm memory
  design: docs/engineering/feedback-memory/README.md
---

# Memory

Read the [Memory design](../../../docs/engineering/feedback-memory/README.md#memory) before changing structured Memory state. Run `pnpm memory --help` for current syntax.

Use Problem for a reproducible problem and its root cause, Decision for an adopted choice, and Insight for know-how that remains useful without a problem lifecycle. Search existing Memory first. Do not create Feedback merely to justify a Memory.

Resolve a product Problem as fixed only after the public-entry E2E regression gate passes. Promote a conclusion by linking to the current Roadmap, Feature, or Engineering target; Memory remains historical evidence and never replaces the target contract.

Legacy unstructured Memory is searchable and referenceable but read-only. Run `check` after mutations and include only the changed Memory files in explicit Git paths.
