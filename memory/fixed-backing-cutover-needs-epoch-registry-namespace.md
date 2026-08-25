---
format: niceeval.memory/v1
id: fixed-backing-cutover-needs-epoch-registry-namespace
title: Declarative fixed backing cutover needs an epoch registry namespace
createdAt: 2026-08-25T11:23:17+08:00
kind:
  type: problem
  state: open
promotions: []
---
# Declarative fixed backing cutover needs an epoch registry namespace

## Observation

Production needed to replace the committed sixteen-slot 2 GiB backing with a distinct four-slot 4 GiB backing. The new `storage.rootDir` and outer image were created and mounted under the exclusive activation lock, but provisioning rejected the old root-level `provision.json` because its slot size, count, image root, and outer path correctly described the previous capsule.

## Root cause

Activation assigned `storage.registryEpoch` only for `--rotate-seeds`. A forward declarative source-config cutover to a different `outerImagePath` therefore reused the legacy root registry and provision namespace, even though capsule and reclaim design treats backing generations as independent.

## Fix

When a forward source configuration changes `outerImagePath` relative to the active committed config, assign the new activation epoch as `storage.registryEpoch` before staging and provisioning. Rollback keeps the registry paths captured in its target capsule, and same-backing reactivation continues adopting the existing root or epoch registry unchanged.

## Verification state

Open until the new 4 GiB backing commits, boot-restore starts its watchdog, and real install/harness dogfood completes. Per the current user direction, no automated E2E suite is being run.
