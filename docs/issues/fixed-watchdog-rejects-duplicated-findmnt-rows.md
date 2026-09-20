---
format: concord.document/v1
id: fixed-watchdog-rejects-duplicated-findmnt-rows
title: Fixed watchdog rejects valid slot mounts in its systemd namespace
createdAt: 2026-08-25T11:14:27+08:00
kind: issue
state: draft
memoryRelations:
  - kind: root-cause
    memory: memory/fixed-watchdog-findmnt-duplicate-mount-rows.md
adoptions:
  current: []
  history: []
origin:
  kind: dogfood
  repository: LeverageEffectLab/it-infra
  originId: ctrdh-studio-fixed-watchdog-findmnt-duplicates
  commit: 70f734c3
subject: product
claim: defect
observation: After activation successfully published and mounted all sixteen fixed slots, the watchdog failed with independent slot is not loop-mounted from its attested image. Inside an equivalent systemd ReadWritePaths mount namespace, findmnt returned two identical source/target rows for the same slot.
impact: The fixed profile has a valid committed epoch and mounted storage but admission never opens, so real evals cannot start.
history:
  - at: 2026-09-14T15:00:25.173Z
    action: migrate
    reason: Transferred the existing observation to its current Issue owner.
    source:
      path: feedback/fixed-watchdog-rejects-duplicated-findmnt-rows/README.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:4bd8ef9dfa79b1bc004acbcf507f192cfae3f30c22b88d419fa6a8e388ae74a5
---
The mount verifier treated duplicate identical rows as one newline-containing source instead of one unambiguous mount identity.
