---
format: concord.document/v1
id: attempt-cleanup-join-truncates-serial-callbacks
title: Attempt cleanup join truncates individually valid serial teardown callbacks
createdAt: 2026-09-05
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
resolution:
  reason: 保留结构化原记录声明的状态；本迁移视图不重新解释。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: |-
      kind:
        type: problem
        state: resolved
        resolution:
          kind: fixed
          proof:
            - netake_1J9E292SKTR2Z2AD
            - niceeval.fixed-evidence/v1:{"selectors":["e2e/plugins/test/eval-plugin-lifecycle.test.ts#necase_KVESCV3S1ZDJ5TYR"]}
    proof:
      - netake_1J9E292SKTR2Z2AD
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/plugins/test/eval-plugin-lifecycle.test.ts#necase_KVESCV3S1ZDJ5TYR"]}
    source:
      path: memory/attempt-cleanup-join-truncates-serial-callbacks.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:fdbbe23aad0a4a60ae49be078af5f42519880585009077648250b33d6fc21c2f
---
Astra review found that the Attempt scope finalizer wrapped the entire Promise-body cleanup join in the same 30 second limit used for one cleanup callback. An Agent teardown taking 20 seconds followed by an Eval Plugin teardown taking 20 seconds each satisfies the per-callback contract, but the aggregate join releases outer resources at 30 seconds and cancels the Plugin callback before completion.

The existing installed Plugin SIGINT owner now uses two sequential 20 second callbacks and checks both completion markers, once-only ordering, cleanup signals, and the preserved interrupted result. Its public old-candidate red must be paired with a fixed candidate and complete reliability takeover before resolution.

The cleanup join must atomically distinguish a body that has entered its bounded cleanup chain from a forward callback that has not reached cleanup. Started cleanup completes before outer resource release. If the framework stops waiting for an unresponsive forward callback, it closes admission before releasing resources so a late finally cannot start teardown against released owners.

## Verification

Validated by the same installed SIGINT owner: nered_E1A4PDPQ53DAWVZE → netake_1J9E292SKTR2Z2AD. Both 20 second callbacks complete in order while retaining the original interrupted result. A separate public CLI diagnostic held Eval Plugin setup until Experiment teardown had begun after the 30 second abandoned-body wait, then released it and observed that late teardown admission stayed closed; diagnostic and process-group cleanup passed. The diagnostic supplements, and does not replace, the formal takeover.
