---
format: niceeval.feedback/v2
id: fixed-activation-uses-flat-systemd-slice-cgroup-path
title: Fixed activation looks for a flattened systemd slice cgroup path
state: open
reportedAt: 2026-08-25T10:52:14+08:00
source:
  kind: dogfood
  repository: LeverageEffectLab/it-infra
  originId: ctrdh-studio-fixed-activation-919e2bc069c443d993687c18b3728b60
  commit: e7668adc
subject: product
claim: defect
observation: Fixed activation rejected the configured aggregate cgroup as unavailable. The host config named /sys/fs/cgroup/niceeval-docker-profile-harness-raw.slice, while systemd exposed the active slice at /sys/fs/cgroup/niceeval.slice/niceeval-docker.slice/niceeval-docker-profile.slice/niceeval-docker-profile-harness.slice/niceeval-docker-profile-harness-raw.slice.
impact: Every fixed-image profile whose alias participates in a systemd slice hierarchy fails activation before store preparation, even when the required slice is active and empty.
memoryRelations:
  - kind: root-cause
    memory: fixed-activation-systemd-slice-cgroup-hierarchy
adoptions:
  current: []
  history: []
---
The generated host config flattened a hierarchical systemd slice name into an impossible cgroup filesystem path.
