---
name: docs-work
description: Prepare, check, and finalize disjoint NiceEval documentation work items for parallel Herdr agents.
metadata:
  command: pnpm docs:work
  design: docs/engineering/docs-work/README.md
---

# Docs Work

Read the [parallel documentation design](../../../docs/engineering/docs-work/README.md) before preparing a run. Run `pnpm docs:work --help` for current syntax.

Use this skill only when two or more document scopes can have disjoint write sets. Keep domain terms, shared structures, indexes, writing rules, and adoption moves with one owner or the finalizer. A Feature Design Package is one write owner unless its shared model is already fixed.

Docs Work creates local inputs and receipts; it never starts or controls agents. Use Herdr for all agent lifecycle operations. Independently check each worker's diff and receipt before finalizing, then run the full `pnpm lint` gate.
