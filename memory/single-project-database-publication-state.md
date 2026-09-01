---
format: niceeval.memory/v1
id: single-project-database-publication-state
title: Use one ProjectDatabase for operational and published Run state
createdAt: 2026-08-31
kind:
  type: decision
  state: adopted
promotions:
  - kind: feature
    current:
      - docs/feature/run/architecture.md#canonical-record-与运行中状态
    history: []
---
## Context

The adopted root-wide SQLite design stored open, sealing, and published Run data in one ProjectDatabase. A later direct-portability refactor mapped publication visibility onto physical files and created one `record-staging-<runId>.sqlite` per Run. Real concurrent evaluation left dozens of staging databases and orphaned resources after owner processes died.

## Decision

A project has exactly one SQLite application database: `.niceeval/record.sqlite`. Run, Attempt, Attachment, Content, recovery, and published facts share that database. Row state, Run-scoped writer generations, project barrier state, publication revisions, foreign keys, and transactional compare-and-set operations define visibility and mutability; database-file boundaries do not.

Attempt publication freezes a complete aggregate and binds its slot in one short transaction. Operational mutations do not advance the public publication clock. Readers start from cutoff-visible publication and binding rows. Recovery fences and closes a Run in one transaction using exact owner-termination evidence.

The same database becomes portable only after a project-wide gate drains writers, closes or recovers active Runs, securely deletes unpublished and coordination rows, truncates WAL, and passes hostile read-only validation. No Snapshot, export, per-Run database, second ProjectDatabase, or whole-database rewrite is introduced.

The new schema is a fresh, unambiguous baseline. Existing ProjectDatabase schemas fail closed and are not migrated, converted, overwritten, or compat-read.

## Consequences

SQLite transactions and constraints again own atomicity, crash recovery, and publication fencing. The runtime must prove secure deletion, cross-process portable-barrier recovery, database-level post-publication immutability, cutoff-safe reader shapes, and strict rejection of predecessor schemas.
