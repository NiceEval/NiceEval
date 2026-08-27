---
format: niceeval.memory/v1
id: fixed-watchdog-journal-state-crosses-activation-generations
title: Fixed watchdog journal state crosses activation generations
createdAt: 2026-08-25T11:27:34+08:00
kind:
  type: problem
  state: open
promotions: []
---
# Fixed watchdog journal state crosses activation generations

## Observation

The 4 GiB backing cutover committed a new capsule, registry epoch, descriptor, outer filesystem, four slot images, and ten seed images. Watchdog startup nevertheless loaded the previous 2 GiB journal snapshot and rejected the first new seed as an immutable-facts change across restart.

## Root cause

Watchdog generation identity included only Docker daemon/socket and asset facts. It did not change with the committed fixed descriptor/backing. Initialization also loaded slot and seed registries before generation reconciliation, so cross-epoch physical state was compared as if it belonged to one steady generation.

## Fix

Include the descriptor digest in generation identity for fixed-image profiles. Immediately after journal replay, a generation mismatch may clear prior slot, seed, artifact, and recovered-lease state only when the same drained-ownership predicate used by exclusive activation holds. Any live lease, reservation, queue, build, container, or setup-prefix operation still fails closed. Registry loading and ordinary generation reconciliation then publish the new epoch state durably.

## Verification state

Open until the corrected generation starts against the already committed 4 GiB epoch and real install/harness dogfood completes. Per the current user direction, no automated E2E suite is being run.
