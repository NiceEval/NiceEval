---
relations:
  - role: root-cause
    target: memory/fixed-image-capacity-assertion-omits-ext4-overhead.md
---

# Fixed-image NixOS assertion accepts a store that provisioning rejects

A 96 GiB store with sixteen 2 GiB slots, ten 2 GiB seeds, and sixteen temporary clones passed the NixOS module assertion, but first activation rejected it because ext4 f_bavail could not cover the 84 GiB ledger plus 12 GiB recovery headroom after metadata and reserved blocks.

## Impact

A configuration accepted at evaluation cannot complete first fixed-image activation, leaving the production profile unavailable until the store is explicitly replaced with a larger image.

The declarative assertion spent the entire nominal 1/8 envelope on recovery and left no allowance for ext4 metadata or reserved blocks.
