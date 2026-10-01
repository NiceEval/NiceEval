---
format: concord.document/v1
id: fixed-activation-blocks-recovered-legacy-leases
title: Fixed activation rejects legacy journals containing only recovered leases
createdAt: 2026-08-25T10:47:43+08:00
kind: issue
state: draft
memoryRelations:
  - kind: root-cause
    memory: memory/fixed-activation-recovered-legacy-leases.md
adoptions:
  current: []
  history: []
origin:
  kind: dogfood
  repository: LeverageEffectLab/it-infra
  originId: ctrdh-studio-fixed-activation-69853d3002344e5ab6bfa2e505283c3e
  commit: 7b40844b
subject: product
claim: defect
observation: The fixed-image activation and its provisioner each rejected the legacy ownership journal as non-drained even though it contained 104 leases all in the terminal recovered state and zero reservations, queue entries, builds, containers, or setup-prefix operations.
impact: A host upgraded from the legacy transient watchdog cannot activate fixed-image storage without manually rewriting durable journal state, despite having no live ownership.
history:
  - at: 2026-09-14T15:00:25.173Z
    action: migrate
    reason: Transferred the existing observation to its current Issue owner.
    source:
      path: feedback/fixed-activation-blocks-recovered-legacy-leases/README.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:fdaebca66feeefb946e174333fa6814c72e6c21600006753d384c5ffe3f650a6
---
The production activation and provisioning boundaries failed closed on terminal receipts retained by the legacy watchdog.
