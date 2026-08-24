---
name: roadmap
description: Design, inspect, revise, or adopt NiceEval Roadmap directions. Use for finalized product targets that are not yet adopted as the current Feature contract; do not use for open alternatives or implementation status.
---

# Roadmap

Read the [Roadmap authoring contract](../../../docs/roadmap/README.md) and the [Trace workflow](../../../docs/engineering/docs-traceability/README.md) before changing a Roadmap package.

A Roadmap is already decided as a target but is not yet the current adopted Feature. Put unresolved alternatives in Design, and put current adopted behavior in Feature. Roadmap text uses the same final-state page roles as Feature and does not contain progress, review status, open questions, or delivery checklists.

Inspect the exact Roadmap package and its `buildsOn` relations before editing. Use `pnpm feature show <related-feature>` when a Feature-side reverse projection exists; do not infer a Roadmap relationship from an ordinary Markdown mention.

Edit existing package pages in place according to the Feature Design Package roles. For new structure, move, or adoption, use the repository-owned Roadmap and Trace commands only after confirming they exist in root scripts and command help. Do not copy templates, hand-move a package into `docs/feature`, rewrite typed refs manually, or leave Roadmap and Feature as two current truths. A missing documented command is a repository-tool implementation gap, not permission to invent a fallback workflow.

Adoption may require human decisions for semantic merges. Preserve those decisions in the tool manifest or stop and ask; do not guess which source paragraphs to drop. After edits, run the relevant Feature trace queries and `pnpm lint`, then commit only the intended package and relation-owner paths.
