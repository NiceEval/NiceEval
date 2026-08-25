---
format: niceeval.memory/v1
id: fixed-image-storage-root-tmpfiles-ownership
title: Fixed-image NixOS module omits the storage root tmpfiles owner
createdAt: 2026-08-25T10:56:46+08:00
kind:
  type: problem
  state: open
promotions: []
---
# Fixed-image NixOS module omits the storage root tmpfiles owner

## Observation

The clean `ctrdh-studio` deployment configured `/data/niceeval/docker-profiles/harness-raw` as `storage.rootDir`, but the directory did not exist after switch. Activation refused to create the outer image because its root-filesystem fallback guard requires the top-level storage root to pre-exist.

## Root cause

The module declared runtime, registry, journal, data-mount, and state directories through systemd-tmpfiles, but omitted the fixed `storage.rootDir`. `RequiresMountsFor` proves the parent mount is available; it does not create the directory.

## Fix

For fixed profiles, declare `storage.rootDir` as a root-owned mode `0700` tmpfiles directory. Activation keeps its existing pre-existence and parent-mount identity checks before fully allocating the store.

## Verification state

Open until the corrected generation creates the directory on `/data`, activation finishes, and real downstream dogfood completes. Per the current user direction, no automated E2E suite is being run.
