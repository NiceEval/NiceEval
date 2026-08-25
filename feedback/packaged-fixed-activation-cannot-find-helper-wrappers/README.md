---
format: niceeval.feedback/v1
id: packaged-fixed-activation-cannot-find-helper-wrappers
title: Packaged fixed activation looks for source helper filenames
state: open
reportedAt: 2026-08-25T11:00:50+08:00
source:
  kind: dogfood
  repository: LeverageEffectLab/it-infra
  originId: ctrdh-studio-fixed-activation-a03e25dba0404476923809732c7ce2c7
  commit: f50992b1
subject: product
claim: defect
observation: After the 96 GiB fixed store was fully allocated, activation failed because it tried to open libexec/niceeval/provision-fixed-images.py. The Nix package installs provision-fixed-images and generate-descriptor as wrapped extensionless executables.
impact: The packaged production activation can prepare storage but cannot provision slots or publish a descriptor, so no fixed watchdog can start.
memoryRelations:
  - kind: root-cause
    memory: fixed-activation-source-vs-packaged-helper-paths
---
Source-tree helper filenames and packaged wrapper filenames diverged at the activation subprocess boundary.