---
name: feature
description: Inspect, design, trace, or revise NiceEval Feature and Use Case contracts. Use for adopted current product behavior; use Roadmap for finalized but unadopted directions and Design for competing plans.
---

# Feature

Read the [Feature authoring contract](../../../docs/feature/README.md) before changing a Feature or Use Case. Run `concord --skill document` for layout, creation and adoption, `concord --skill test` for test markers, and each command's `--help` for current syntax.

A Feature is the adopted current product target, even when implementation has not caught up. A finalized but unadopted direction belongs in Roadmap; alternatives that still require comparison belong in Design. Do not weaken a Feature into an implementation-status document.

Before editing, use `concord list feature` and `concord show <id>` to identify the exact package, page roles, Use Cases, related tests, Issues, Memory, and docs. Test coverage is derived only through test markers → exact contract; never infer it from directories, filenames, or readable titles.

Keep each fact in its owning page. Put public TypeScript shape in `library.md`, command behavior in `cli.md`, internal invariants in `architecture.md`, cross-owner sequencing in `lifecycle.md`, and one minimal user goal in each leaf Use Case. Strong relations remain with their source owner; do not add a reverse registry or formatter metadata.

Create a Feature with `concord new feature <id>` and a leaf Use Case with `concord new use-case <id> --feature <feature>`; edit existing pages directly. Do not copy templates or hand-write generated indexes.

After changes, run `concord show <feature>` for the affected Feature, `concord check`, and `pnpm lint`; run `pnpm typecheck` when repository tooling or TypeScript examples changed. Commit only the intended Feature, Use Case, and relation-owner paths.
