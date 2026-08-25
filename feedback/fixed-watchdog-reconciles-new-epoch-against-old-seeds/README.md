---
format: niceeval.feedback/v1
id: fixed-watchdog-reconciles-new-epoch-against-old-seeds
title: Fixed watchdog reconciles a new epoch against prior seed facts
state: open
reportedAt: 2026-08-25T11:27:34+08:00
source:
  kind: dogfood
  repository: LeverageEffectLab/it-infra
  originId: ctrdh-studio-fixed-watchdog-cross-epoch-journal
  commit: 975fb8f4
subject: product
claim: defect
observation: A new committed 4 GiB registry epoch passed activation, descriptor generation, and mount attestation, but watchdog startup loaded the prior 2 GiB journal state and rejected seed-00000000 because its immutable registry facts changed across restart.
impact: Every legitimate fixed backing or seed epoch rotation can commit successfully yet leave admission closed because the steady-state journal treats cross-epoch physical identities as same-generation drift.
memoryRelations:
  - kind: root-cause
    memory: fixed-watchdog-journal-state-crosses-activation-generations
---
Watchdog generation identity covered Docker and assets but omitted the committed fixed descriptor/backing, and registry loading happened before any generation reset.
