---
format: niceeval.memory/v1
id: e2e-case-relations-are-runner-owned
title: E2E relations are owned by runner-collected cases
createdAt: 2026-08-28
kind:
  type: decision
  state: adopted
promotions: []
---
## Decision

E2E Trace relations are owned per runner-collected case rather than per source file. Every live case carries a permanent opaque `necase_...` token in its runner-visible title and is selected as `<repo-relative-path>#<caseId>`: ID is identity and path is a stale guard.

A Git-tracked adjacent sidecar owns current, append-only history, and tombstones. Each live case has exactly one testing owner and zero or more Problem Memory and direct Issue provenance relations. An owner can serve multiple cases and points to exactly one Feature or leaf Use Case; product projections follow only case → owner → contract.

Vitest and Playwright inventory adapters use native runner collection without executing test bodies. AST or source discovery is forbidden. Formal red, green, and reliability runner receipts form a takeover certificate; diagnostic receipts are excluded. Resolving a Problem as fixed requires a current regression case and the complete certificate.

All owner/case/relation changes use named lifecycle commands and a recoverable multi-file Trace transaction. Legacy file metadata migrates through plan/apply; multi-case regression and Issue relations require explicit per-case mapping.

## Rationale

Files are containers and can hold several independently runnable outcomes. Runner-collected cases are the smallest execution subjects that preserve identity across title/path changes, bind exact evidence, and avoid a second AST discovery truth. Sidecars keep relation history reviewable without mixing machine lifecycle state into executable test prose.

## Adopted target

The complete schema, command tree, receipts, recovery, Issue verification, migration, and acceptance matrix are adopted in `docs/engineering/testing/e2e/case-relations.md` and synchronized into Trace, Testing, Feature, Memory, and Issue rules.
