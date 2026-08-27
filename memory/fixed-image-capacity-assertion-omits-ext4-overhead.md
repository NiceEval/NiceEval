---
format: niceeval.memory/v1
id: fixed-image-capacity-assertion-omits-ext4-overhead
title: Fixed-image capacity assertion omits ext4 overhead
createdAt: 2026-08-25T11:09:52+08:00
kind:
  type: problem
  state: open
promotions: []
---
# Fixed-image capacity assertion omits ext4 overhead

## Observation

The `ctrdh-studio` profile declared sixteen 2 GiB slots, ten 2 GiB seeds, sixteen worst-case temporary clones, and a 96 GiB outer store. Nix evaluation accepted the configuration, while the production provisioner measured ext4 `f_bavail` and rejected the same store before publishing any registry or epoch.

## Root cause

The module allowed the slot/seed/clone ledger to consume exactly seven eighths of the outer image. The runtime correctly reserves another eighth for recovery, but `f_bavail` also excludes ext4 reserved blocks and metadata. At the equality boundary there can therefore never be enough available space.

## Fix

Require the fixed-image ledger to fit within three quarters of the declared outer store. The remaining quarter covers the provisioner's recovery headroom plus ext4 metadata and reserved-block overhead. Production sizing for the observed 84 GiB ledger is raised from 96 GiB to 112 GiB.

## Verification state

Open until a clean NixOS generation rejects the old 96 GiB declaration, provisions the 112 GiB store, starts the fixed watchdog, and completes real downstream dogfood. Per the current user direction, no automated E2E suite is being run.
