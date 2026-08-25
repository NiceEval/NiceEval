---
format: niceeval.feedback/v2
id: fixed-activation-storage-root-is-not-declared
title: Fixed-image NixOS module does not create its configured storage root
state: open
reportedAt: 2026-08-25T10:56:46+08:00
source:
  kind: dogfood
  repository: LeverageEffectLab/it-infra
  originId: ctrdh-studio-fixed-activation-storage-root
  commit: 7c87e346
subject: product
claim: defect
observation: After all ownership and cgroup gates passed, fixed activation failed with portable fixed storage paths/size are invalid because /data/niceeval/docker-profiles/harness-raw did not exist. The NixOS module required the path's mount but did not declare the root directory.
impact: A clean first deployment cannot prepare its fixed-image store without an imperative root mkdir, defeating reproducible NixOS ownership and root-filesystem fallback protection.
memoryRelations:
  - kind: root-cause
    memory: fixed-image-storage-root-tmpfiles-ownership
adoptions:
  current: []
  history: []
---
The module configured storage.rootDir but omitted the corresponding tmpfiles directory declaration.
