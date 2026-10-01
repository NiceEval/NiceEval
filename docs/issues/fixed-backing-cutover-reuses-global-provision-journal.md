---
format: concord.document/v1
id: fixed-backing-cutover-reuses-global-provision-journal
title: Declarative fixed backing cutover reuses the previous provision journal
createdAt: 2026-08-25T11:23:17+08:00
kind: issue
state: draft
memoryRelations:
  - kind: root-cause
    memory: memory/fixed-backing-cutover-needs-epoch-registry-namespace.md
adoptions:
  current: []
  history: []
origin:
  kind: dogfood
  repository: LeverageEffectLab/it-infra
  originId: ctrdh-studio-fixed-4g-backing-cutover
  commit: 84ba3071
subject: product
claim: defect
observation: After changing storage.rootDir to rotate from sixteen 2 GiB slots to four 4 GiB slots, exclusive activation mounted the independent new outer image but the provisioner read the prior root-level provision.json and failed with fixed-image provision journal identity differs from configured policy.
impact: A legitimate declarative capacity migration cannot publish a new epoch even though the old committed capsule remains intact and the new backing has a distinct identity.
history:
  - at: 2026-09-14T15:00:25.173Z
    action: migrate
    reason: Transferred the existing observation to its current Issue owner.
    source:
      path: feedback/fixed-backing-cutover-reuses-global-provision-journal/README.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:6c9157f0d5bc6f47da8ab16b57d0883f7bc5ad8bc90c2886ebdae84136729084
---
Only the explicit seed-rotation flag assigned registryEpoch; an ordinary source-config backing change did not isolate its registry and provision state.
