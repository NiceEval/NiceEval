---
format: concord.document/v1
id: fixed-image-module-understates-ext4-capacity-envelope
title: Fixed-image NixOS assertion accepts a store that provisioning rejects
createdAt: 2026-08-25T11:09:52+08:00
kind: issue
state: draft
memoryRelations:
  - kind: root-cause
    memory: memory/fixed-image-capacity-assertion-omits-ext4-overhead.md
adoptions:
  current: []
  history: []
origin:
  kind: dogfood
  repository: LeverageEffectLab/it-infra
  originId: ctrdh-studio-fixed-activation-capacity-proof
  commit: bfda1c79
subject: product
claim: defect
observation: A 96 GiB store with sixteen 2 GiB slots, ten 2 GiB seeds, and sixteen temporary clones passed the NixOS module assertion, but first activation rejected it because ext4 f_bavail could not cover the 84 GiB ledger plus 12 GiB recovery headroom after metadata and reserved blocks.
impact: A configuration accepted at evaluation cannot complete first fixed-image activation, leaving the production profile unavailable until the store is explicitly replaced with a larger image.
history:
  - at: 2026-09-14T15:00:25.173Z
    action: migrate
    reason: Transferred the existing observation to its current Issue owner.
    source:
      path: feedback/fixed-image-module-understates-ext4-capacity-envelope/README.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:7a70435eed3e90241220bda105c69c02f9b298194b045c33ce464d43e0c6996b
---
The declarative assertion spent the entire nominal 1/8 envelope on recovery and left no allowance for ext4 metadata or reserved blocks.
