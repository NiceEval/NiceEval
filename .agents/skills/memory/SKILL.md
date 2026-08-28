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

Use native CLI fields instead of assembling metadata or resolution JSON. Create with `pnpm memory add <id> --title <title> --kind <problem|decision|insight> --body <markdown>`; `--created-at` is optional. Resolve with `pnpm memory resolve <id> --kind <kind> --proof <receipt>`, repeating `--proof` for each independent receipt. For author changes, use the managed `memory author set` operation from `--help`: it changes only the current author region before the `Resolution history` marker, binds both the complete owner preimage and author-region preimage digests, never writes legacy Memory, and never removes managed history.

Resolve a product Problem as fixed only when a current runner-inventoried case points to it and formal red, green, and complete takeover-certificate receipts validate for that same case/candidate. A diagnose receipt, legacy file metadata, retired case, or free-form proof cannot pass. Promote a conclusion by linking to the exact current Roadmap, Feature, Use Case, or Engineering target; Memory remains historical evidence and never replaces the target contract. Use `retire` when an exact promotion stops being current, and never edit promotion history by hand.

Legacy unstructured Memory is searchable and referenceable but read-only. Historical Memory is lifecycle evidence, not a generic record that can be physically deleted. Run `check` after mutations and include only the changed Memory files in explicit Git paths. If a read reports `TraceRecoveryRequired`, do not inspect the owner directly; run `pnpm run repo docs trace recover` and retry the public command.
