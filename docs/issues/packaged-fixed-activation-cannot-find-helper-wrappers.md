---
format: concord.document/v1
id: packaged-fixed-activation-cannot-find-helper-wrappers
title: Packaged fixed activation looks for source helper filenames
createdAt: 2026-08-25T11:00:50+08:00
kind: issue
state: draft
memoryRelations:
  - kind: root-cause
    memory: memory/fixed-activation-source-vs-packaged-helper-paths.md
adoptions:
  current: []
  history: []
origin:
  kind: dogfood
  repository: LeverageEffectLab/it-infra
  originId: ctrdh-studio-fixed-activation-a03e25dba0404476923809732c7ce2c7
  commit: f50992b1
subject: product
claim: defect
observation: After the 96 GiB fixed store was fully allocated, activation failed because it tried to open libexec/niceeval/provision-fixed-images.py. The Nix package installs provision-fixed-images and generate-descriptor as wrapped extensionless executables.
impact: The packaged production activation can prepare storage but cannot provision slots or publish a descriptor, so no fixed watchdog can start.
history:
  - at: 2026-09-14T15:00:25.173Z
    action: migrate
    reason: Transferred the existing observation to its current Issue owner.
    source:
      path: feedback/packaged-fixed-activation-cannot-find-helper-wrappers/README.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:6ee3d74190477978e6e9a688bf24b50e9971d9f24e2e9591afadcd66eb41b241
---
Source-tree helper filenames and packaged wrapper filenames diverged at the activation subprocess boundary.
