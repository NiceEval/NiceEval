---
format: concord.document/v1
id: incus-revision-two-schema-authorization-breaks-planning
title: Incus revision 2 schema authorization breaks planning
createdAt: 2026-08-27
kind: memory
memoryKind: problem
state: resolved
epoch: 0
promotions: []
history: []
resolution:
  reason: 保留结构化原记录声明的状态；本迁移视图不重新解释。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: >-
      kind:
        type: problem
        state: resolved
        resolution:
          kind: fixed
          proof:
            - "main E2E red: run 33082665372, docker-3 job 98555987722 stopped before artifact publication"
            - "installed exact-candidate owner passed: pnpm --dir /tmp/niceeval-incus-fixed.6ADb6Q exec vitest run test/incus-user-database-ledger.test.ts (58.3s)"
            - "main E2E green twice: runs 33086183347 and 33086382261, including repo-batch-docker-3"
    proof:
      - "main E2E red: run 33082665372, docker-3 job 98555987722 stopped before
        artifact publication"
      - "installed exact-candidate owner passed: pnpm --dir
        /tmp/niceeval-incus-fixed.6ADb6Q exec vitest run
        test/incus-user-database-ledger.test.ts (58.3s)"
      - "main E2E green twice: runs 33086183347 and 33086382261, including
        repo-batch-docker-3"
    source:
      path: memory/incus-revision-two-schema-authorization-breaks-planning.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:1c5f562d8a7277c1442a50a01cb505ad8a0ded9a766a92e6c1053199399043c9
---
## Problem

The installed-package Incus ledger Journey stopped during physical planning before the first prepared artifact was published. The visible assertion only reported zero publish requests, while the CLI first crashed with `failure.actions is not iterable` and then hid the repository failure behind the aggregate planning message.

## Root cause

Incus repository revision 2 added replacement-head, consumer-lease, and destroy-receipt tables plus their automatic indexes without adding those exact objects to the UserDatabase static schema allowlist. Its schema query was also left as unqualified `sqlite_schema`, so SQLite name resolution probed the forbidden temp schema. Finally, the Effect error mapper treated an Effect `Cause` as an `IncusProviderError` instead of normalizing it through `toPlanningError`.

## Repair boundary

Keep the UserDatabase authorizer fail closed. Qualify the repository query as `main.sqlite_schema`, allow only the six exact revision-2 schema objects, and normalize the Effect failure before projecting the public planning error. Preserve the CLI diagnostic and provider journal in the E2E assertion so a future pre-publication failure exposes its cause.

## Regression proof

The installed-package owner `e2e/lifecycle/test/incus-user-database-ledger.test.ts` must complete cold publication, warm reuse, crash recovery, capacity fail-closed behavior, and replacement-lineage fencing against the fake Incus public CLI boundary.
