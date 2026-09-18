---
format: concord.document/v1
id: pty-cleanup-kills-helper-before-exit-report
title: PTY cleanup kills helper before candidate exit report
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
            - "main E2E red: run 33081322990, docker-3 job 98550429131 lost the candidate terminal-state frame"
            - "installed Testkit stress receipts: timeout target 25/25 and full PTY owner 7/7 passed"
            - "main E2E green twice: runs 33086183347 and 33086382261, including repo-batch-docker-3"
    proof:
      - "main E2E red: run 33081322990, docker-3 job 98550429131 lost the
        candidate terminal-state frame"
      - "installed Testkit stress receipts: timeout target 25/25 and full PTY
        owner 7/7 passed"
      - "main E2E green twice: runs 33086183347 and 33086382261, including
        repo-batch-docker-3"
    source:
      path: memory/pty-cleanup-kills-helper-before-exit-report.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:2af04398771c07c467c26b5aebf2f88cd170c5bbafc232710db02293ac738b03
---
## Problem

Testkit PTY timeout cleanup occasionally rejected a successful three-group cleanup with `PTY helper exited without reporting the candidate terminal state`. The installed-candidate nightly E2E reproduced it while killing a TERM-ignoring candidate and its descendant.

## Root cause

After SIGKILL made the candidate process group terminal, the parent cleanup immediately advanced to terminating the helper group. The helper owns the child-process wait status, so under scheduler delay it could be killed before its child `close` callback sent the `status: exit` control frame. Timeout disposal and launcher-close finalization could also enter the same group cleanup concurrently.

## Repair boundary

Keep the real candidate exit frame authoritative. After the candidate group reaches a proven terminal state, allow the owned helper a bounded interval to reap the child and flush that frame before terminating helper and launcher groups. Coalesce every cleanup caller onto one promise; do not infer candidate status from the launcher or weaken fail-closed process-group checks.

## Regression proof

The existing installed-package owner `e2e/lifecycle/test/pty-terminal-cleanup.test.ts` must kill a TERM-ignoring candidate plus descendant, return a timed-out receipt with the real signal/exit state, and prove candidate, helper, and launcher groups gone or terminal.
