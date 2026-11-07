---
name: memory
description: Record, search, rewrite, or link NiceEval development problems, decisions, and reusable insights.
metadata:
  command: concord memory
  design: docs/engineering/feedback-memory/README.md
---

# Memory

Run `concord --skill memory` for the Memory model and workflow, and `concord memory --help` for current syntax. Read the [Memory design](../../../docs/engineering/feedback-memory/README.md#memory) for NiceEval-specific rules.

Search existing Memory with `concord memory search <query>` before writing a new one. Do not create an Issue merely to justify a Memory. Link a conclusion to the exact current Roadmap, Feature, Use Case, or Engineering target with `concord memory link <id> <target>`; Memory never replaces the target contract.

Run `concord check` after edits and include only the changed Memory files in explicit Git paths.
