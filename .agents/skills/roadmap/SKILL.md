---
name: roadmap
description: Design, inspect, revise, or adopt NiceEval Roadmap directions. Use for finalized product targets that are not yet adopted as the current Feature contract; do not use for open alternatives or implementation status.
---

# Roadmap

Read the [Roadmap authoring contract](../../../docs/roadmap/README.md) before changing a Roadmap package.

A Roadmap is already decided as a target but is not yet the current adopted Feature. Put unresolved alternatives in Design, and put current adopted behavior in Feature. Roadmap text uses the same final-state page roles as Feature and does not contain progress, review status, open questions, or delivery checklists.

Inspect the exact Roadmap package and its `buildsOn` relations before editing. Use `concord show <related-feature>` when a Feature-side reverse projection exists; do not infer a Roadmap relationship from an ordinary Markdown mention.

Edit existing package pages in place according to the Feature Design Package roles. Run `concord --skill document` for creation and adoption: create with `concord new roadmap <id>`, inspect with `concord list roadmap` and `concord show <id>`, and adopt with `concord roadmap start <id>`. Do not hand-move a package into `docs/feature` or leave Roadmap and Feature as two current truths.

Adoption may require human decisions for semantic merges. Stop and ask; do not guess which source paragraphs to drop. After edits, run `concord show <feature>`, `concord check`, and `pnpm lint`, then commit only the intended package and relation-owner paths.
