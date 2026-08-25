---
format: niceeval.memory/v1
id: fixed-watchdog-findmnt-duplicate-mount-rows
title: Fixed watchdog misreads duplicate findmnt rows in a systemd mount namespace
createdAt: 2026-08-25T11:14:27+08:00
kind:
  type: problem
  state: open
promotions: []
---
# Fixed watchdog misreads duplicate findmnt rows in a systemd mount namespace

## Observation

The first production activation committed a valid epoch and mounted all sixteen writable slot images. Starting the fixed watchdog then failed during independent-image attestation even though host `findmnt` and `losetup -j` agreed for every registry record.

## Root cause

The watchdog runs with systemd `ReadWritePaths`, which creates a private mount namespace. A transient unit with the same property returned two identical `SOURCE,TARGET` rows for a slot mount. `_slot_facts` stripped the full multi-line output into one source string, so the loop-device membership check failed.

## Fix

Parse exact-mount `findmnt` output as a set of source/target rows. Duplicate identical rows collapse to one identity; zero rows, multiple distinct identities, malformed rows, a target mismatch, or a non-loop source still fail closed. Reuse that parser for free-slot attestation.

## Verification state

Open until the corrected NixOS generation starts the fixed watchdog and real install/harness dogfood completes. Per the current user direction, no automated E2E suite is being run.
