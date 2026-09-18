---
format: concord.document/v1
id: fixed-watchdog-unit-rejected-on-first-deploy
title: Fixed-image watchdog unit is rejected for unbalanced ExecStartPost quoting
createdAt: 2026-08-25T10:39:31+08:00
kind: issue
state: draft
memoryRelations:
  - kind: root-cause
    memory: memory/fixed-watchdog-systemd-execstartpost-quoting.md
adoptions:
  current: []
  history: []
origin:
  kind: dogfood
  repository: LeverageEffectLab/it-infra
  originId: ctrdh-studio-comin-a44850b4-0225-42f9-9ab8-53f93f63e410
  commit: 7bddd105f62e0d80237c3854914b29e2beba1cbd
subject: product
claim: defect
observation: Deploying the NiceEval 7a69dd917 fixed-image NixOS module generated niceeval-docker-profile-fixed-watchdog-harness-raw.service with an ExecStartPost value that systemd rejected as unbalanced quoting. The unit entered bad-setting before the fixed-image profile could be activated.
impact: A first fixed-image deployment cannot start its watchdog, so comin reports a failed switch and downstream Eval invocations continue using the legacy transient profile.
history:
  - at: 2026-09-14T15:00:25.173Z
    action: migrate
    reason: Transferred the existing observation to its current Issue owner.
    source:
      path: feedback/fixed-watchdog-unit-rejected-on-first-deploy/README.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:b9afa95838985552595ab9ebf82ff55983ee3fce912cad12e50074c23e406dc0
---
The first fixed-image deployment on ctrdh-studio built successfully but systemd rejected the generated watchdog unit before activation.
