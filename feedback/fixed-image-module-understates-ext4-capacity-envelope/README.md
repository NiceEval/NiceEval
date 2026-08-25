---
format: niceeval.feedback/v2
id: fixed-image-module-understates-ext4-capacity-envelope
title: Fixed-image NixOS assertion accepts a store that provisioning rejects
state: open
reportedAt: 2026-08-25T11:09:52+08:00
source:
  kind: dogfood
  repository: LeverageEffectLab/it-infra
  originId: ctrdh-studio-fixed-activation-capacity-proof
  commit: bfda1c79
subject: product
claim: defect
observation: A 96 GiB store with sixteen 2 GiB slots, ten 2 GiB seeds, and sixteen temporary clones passed the NixOS module assertion, but first activation rejected it because ext4 f_bavail could not cover the 84 GiB ledger plus 12 GiB recovery headroom after metadata and reserved blocks.
impact: A configuration accepted at evaluation cannot complete first fixed-image activation, leaving the production profile unavailable until the store is explicitly replaced with a larger image.
memoryRelations:
  - kind: root-cause
    memory: fixed-image-capacity-assertion-omits-ext4-overhead
adoptions:
  current: []
  history: []
---
The declarative assertion spent the entire nominal 1/8 envelope on recovery and left no allowance for ext4 metadata or reserved blocks.
