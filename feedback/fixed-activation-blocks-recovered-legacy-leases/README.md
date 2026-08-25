---
format: niceeval.feedback/v1
id: fixed-activation-blocks-recovered-legacy-leases
title: Fixed activation rejects legacy journals containing only recovered leases
state: open
reportedAt: 2026-08-25T10:47:43+08:00
source:
  kind: dogfood
  repository: LeverageEffectLab/it-infra
  originId: ctrdh-studio-fixed-activation-69853d3002344e5ab6bfa2e505283c3e
  commit: 7b40844b
subject: product
claim: defect
observation: The fixed-image activation and its provisioner each rejected the legacy ownership journal as non-drained even though it contained 104 leases all in the terminal recovered state and zero reservations, queue entries, builds, containers, or setup-prefix operations.
impact: A host upgraded from the legacy transient watchdog cannot activate fixed-image storage without manually rewriting durable journal state, despite having no live ownership.
memoryRelations:
  - kind: root-cause
    memory: fixed-activation-recovered-legacy-leases
---
The production activation and provisioning boundaries failed closed on terminal receipts retained by the legacy watchdog.
