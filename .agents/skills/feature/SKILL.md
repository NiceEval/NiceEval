---
name: feature
description: Inspect, design, trace, or revise NiceEval Feature and Use Case contracts. Use for adopted current product behavior; use Roadmap for finalized but unadopted directions and Design for competing plans.
metadata:
  command: pnpm run repo docs feature
  design: docs/feature/README.md
---

# Feature

Read the [Feature authoring contract](../../../docs/feature/README.md) and the [Trace workflow](../../../docs/engineering/docs-traceability/README.md) before changing a Feature or Use Case. Run `pnpm run repo docs feature --help` for current command syntax.

A Feature is the adopted current product target, even when implementation has not caught up. A finalized but unadopted direction belongs in Roadmap; alternatives that still require comparison belong in Design. Do not weaken a Feature into an implementation-status document.

Before editing, use `pnpm run repo docs feature list` and `pnpm run repo docs feature show` to identify the exact package, page roles, direct Use Cases, runner-inventoried cases, Feedback/Memory evidence, and related docs. Test coverage is derived only through case sidecar → owner → exact contract; never infer it from directories, filenames, or readable titles.

Keep each fact in its owning page. Put public TypeScript shape in `library.md`, command behavior in `cli.md`, internal invariants in `architecture.md`, cross-owner sequencing in `lifecycle.md`, and one minimal user goal in each leaf Use Case. Strong relations remain with their source owner; do not add a reverse registry or formatter metadata.

The first planned Feature structure surface is limited to managed `feature create`, `feature page add`, and `feature page set`; use it only once `--help` exposes it. It never creates a package implicitly, and it is not `retire`, physical delete, move, or Roadmap adoption. Use Case creation remains an independent repository-tool gap. Do not copy templates, hand-write generated indexes, or fabricate a receipt.

After changes, rerun `pnpm run repo docs feature show` for the affected Feature and `pnpm run repo docs test show` for changed test owners. Run `pnpm lint`; run `pnpm typecheck` when repository tooling or TypeScript examples changed. Commit only the intended Feature, Use Case, relation-owner, and generated-index paths.
