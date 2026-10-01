---
format: concord.document/v1
id: fixed-activation-uses-flat-systemd-slice-cgroup-path
title: Fixed activation looks for a flattened systemd slice cgroup path
createdAt: 2026-08-25T10:52:14+08:00
kind: issue
state: draft
memoryRelations:
  - kind: root-cause
    memory: memory/fixed-activation-systemd-slice-cgroup-hierarchy.md
adoptions:
  current: []
  history: []
origin:
  kind: dogfood
  repository: LeverageEffectLab/it-infra
  originId: ctrdh-studio-fixed-activation-919e2bc069c443d993687c18b3728b60
  commit: e7668adc
subject: product
claim: defect
observation: Fixed activation rejected the configured aggregate cgroup as unavailable. The host config named /sys/fs/cgroup/niceeval-docker-profile-harness-raw.slice, while systemd exposed the active slice at /sys/fs/cgroup/niceeval.slice/niceeval-docker.slice/niceeval-docker-profile.slice/niceeval-docker-profile-harness.slice/niceeval-docker-profile-harness-raw.slice.
impact: Every fixed-image profile whose alias participates in a systemd slice hierarchy fails activation before store preparation, even when the required slice is active and empty.
history:
  - at: 2026-09-14T15:00:25.173Z
    action: migrate
    reason: Transferred the existing observation to its current Issue owner.
    source:
      path: feedback/fixed-activation-uses-flat-systemd-slice-cgroup-path/README.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:210b1fb6b333a4ff7baa225ff1fcb8fe585ffe2a9272f7b8c1a5e17f51f5f54d
---
The generated host config flattened a hierarchical systemd slice name into an impossible cgroup filesystem path.
