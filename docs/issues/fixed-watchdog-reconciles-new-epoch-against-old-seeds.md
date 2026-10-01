---
format: concord.document/v1
id: fixed-watchdog-reconciles-new-epoch-against-old-seeds
title: Fixed watchdog reconciles a new epoch against prior seed facts
createdAt: 2026-08-25T11:27:34+08:00
kind: issue
state: draft
memoryRelations:
  - kind: root-cause
    memory: memory/fixed-watchdog-journal-state-crosses-activation-generations.md
adoptions:
  current: []
  history: []
origin:
  kind: dogfood
  repository: LeverageEffectLab/it-infra
  originId: ctrdh-studio-fixed-watchdog-cross-epoch-journal
  commit: 975fb8f4
subject: product
claim: defect
observation: A new committed 4 GiB registry epoch passed activation, descriptor generation, and mount attestation, but watchdog startup loaded the prior 2 GiB journal state and rejected seed-00000000 because its immutable registry facts changed across restart.
impact: Every legitimate fixed backing or seed epoch rotation can commit successfully yet leave admission closed because the steady-state journal treats cross-epoch physical identities as same-generation drift.
history:
  - at: 2026-09-14T15:00:25.173Z
    action: migrate
    reason: Transferred the existing observation to its current Issue owner.
    source:
      path: feedback/fixed-watchdog-reconciles-new-epoch-against-old-seeds/README.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:8303a23bbdc8d23f61a0813b9d0b13c1d255c7aab7fd23ba48027e07eba40bca
---
Watchdog generation identity covered Docker and assets but omitted the committed fixed descriptor/backing, and registry loading happened before any generation reset.
