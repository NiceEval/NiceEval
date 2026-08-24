---
name: feature
description: Inspect, design, trace, or revise NiceEval Feature and Use Case contracts. Use for adopted current product behavior; use Roadmap for finalized but unadopted directions and Design for competing plans.
metadata:
  command: pnpm feature
  design: docs/feature/README.md
---

# Feature

Read the [Feature authoring contract](../../../docs/feature/README.md) and the [Trace workflow](../../../docs/engineering/docs-traceability/README.md) before changing a Feature or Use Case. Run `pnpm feature --help` for current command syntax.

A Feature is the adopted current product target, even when implementation has not caught up. A finalized but unadopted direction belongs in Roadmap; alternatives that still require comparison belong in Design. Do not weaken a Feature into an implementation-status document.

Before editing, use `feature list` and `feature show` to identify the exact package, page roles, direct Use Cases, tests, Feedback/Memory evidence, and related docs. Follow existing links rather than inferring the contract from source code or test titles.

Keep each fact in its owning page. Put public TypeScript shape in `library.md`, command behavior in `cli.md`, internal invariants in `architecture.md`, cross-owner sequencing in `lifecycle.md`, and one minimal user goal in each leaf Use Case. Strong relations remain with their source owner; do not add a reverse registry or formatter metadata.

For new package structure, use the repository-owned `feature create` or `use-case create` command only when it appears in command help. Do not copy templates, hand-write generated indexes, or fabricate a receipt. If the documented create command is not implemented, report that tooling gap or implement it only when the user's task includes repository-tool work.

After changes, rerun `feature show` for the affected Feature and `test show` for changed test owners. Run `pnpm lint`; run `pnpm typecheck` when repository tooling or TypeScript examples changed. Commit only the intended Feature, Use Case, relation-owner, and generated-index paths.
