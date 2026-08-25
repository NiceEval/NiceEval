---
format: niceeval.memory/v1
id: fixed-activation-systemd-slice-cgroup-hierarchy
title: Fixed activation flattens the systemd slice cgroup hierarchy
createdAt: 2026-08-25T10:52:14+08:00
kind:
  type: problem
  state: open
promotions: []
---
# Fixed activation flattens the systemd slice cgroup hierarchy

## Observation

The fixed activation dependency pointed at `/sys/fs/cgroup/niceeval-docker-profile-harness-raw.slice`, which did not exist. `systemctl show` reported the active slice under the hierarchical cgroup path derived from every dash-separated slice prefix.

## Root cause

`nix/lib/paths.nix` assumed a systemd slice unit name maps to one flat cgroup directory. Systemd maps `a-b-c.slice` to `a.slice/a-b.slice/a-b-c.slice`, so every configured aggregate path was wrong.

## Fix

Derive the cgroup filesystem path from the full systemd slice hierarchy, including every cumulative prefix of the profile alias. Activation continues to resolve the path strictly and prove the entire cgroup v2 subtree empty.

## Verification state

Open until the corrected host config is deployed, activation proves the real slice empty, and real downstream dogfood completes. Per the current user direction, no automated E2E suite is being run.
