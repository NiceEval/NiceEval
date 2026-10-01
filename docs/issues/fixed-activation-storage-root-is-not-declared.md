---
format: concord.document/v1
id: fixed-activation-storage-root-is-not-declared
title: Fixed-image NixOS module does not create its configured storage root
createdAt: 2026-08-25T10:56:46+08:00
kind: issue
state: draft
memoryRelations:
  - kind: root-cause
    memory: memory/fixed-image-storage-root-tmpfiles-ownership.md
adoptions:
  current: []
  history: []
origin:
  kind: dogfood
  repository: LeverageEffectLab/it-infra
  originId: ctrdh-studio-fixed-activation-storage-root
  commit: 7c87e346
subject: product
claim: defect
observation: After all ownership and cgroup gates passed, fixed activation failed with portable fixed storage paths/size are invalid because /data/niceeval/docker-profiles/harness-raw did not exist. The NixOS module required the path's mount but did not declare the root directory.
impact: A clean first deployment cannot prepare its fixed-image store without an imperative root mkdir, defeating reproducible NixOS ownership and root-filesystem fallback protection.
history:
  - at: 2026-09-14T15:00:25.173Z
    action: migrate
    reason: Transferred the existing observation to its current Issue owner.
    source:
      path: feedback/fixed-activation-storage-root-is-not-declared/README.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:6fd67bfef7e1265284cbcd11542fe6a959642947c77607e68814840756f0133d
---
The module configured storage.rootDir but omitted the corresponding tmpfiles directory declaration.
