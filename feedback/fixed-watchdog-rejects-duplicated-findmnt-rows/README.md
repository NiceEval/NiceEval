---
format: niceeval.feedback/v2
id: fixed-watchdog-rejects-duplicated-findmnt-rows
title: Fixed watchdog rejects valid slot mounts in its systemd namespace
state: open
reportedAt: 2026-08-25T11:14:27+08:00
source:
  kind: dogfood
  repository: LeverageEffectLab/it-infra
  originId: ctrdh-studio-fixed-watchdog-findmnt-duplicates
  commit: 70f734c3
subject: product
claim: defect
observation: After activation successfully published and mounted all sixteen fixed slots, the watchdog failed with independent slot is not loop-mounted from its attested image. Inside an equivalent systemd ReadWritePaths mount namespace, findmnt returned two identical source/target rows for the same slot.
impact: The fixed profile has a valid committed epoch and mounted storage but admission never opens, so real evals cannot start.
memoryRelations:
  - kind: root-cause
    memory: fixed-watchdog-findmnt-duplicate-mount-rows
adoptions:
  current: []
  history: []
---
The mount verifier treated duplicate identical rows as one newline-containing source instead of one unambiguous mount identity.
