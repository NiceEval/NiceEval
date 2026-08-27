---
format: niceeval.feedback/v2
id: fixed-backing-cutover-reuses-global-provision-journal
title: Declarative fixed backing cutover reuses the previous provision journal
state: open
reportedAt: 2026-08-25T11:23:17+08:00
source:
  kind: dogfood
  repository: LeverageEffectLab/it-infra
  originId: ctrdh-studio-fixed-4g-backing-cutover
  commit: 84ba3071
subject: product
claim: defect
observation: After changing storage.rootDir to rotate from sixteen 2 GiB slots to four 4 GiB slots, exclusive activation mounted the independent new outer image but the provisioner read the prior root-level provision.json and failed with fixed-image provision journal identity differs from configured policy.
impact: A legitimate declarative capacity migration cannot publish a new epoch even though the old committed capsule remains intact and the new backing has a distinct identity.
memoryRelations:
  - kind: root-cause
    memory: fixed-backing-cutover-needs-epoch-registry-namespace
adoptions:
  current: []
  history: []
---
Only the explicit seed-rotation flag assigned registryEpoch; an ordinary source-config backing change did not isolate its registry and provision state.
