---
format: niceeval.memory/v1
id: fixed-activation-recovered-legacy-leases
title: Fixed activation mistakes legacy recovered lease receipts for live ownership
createdAt: 2026-08-25T10:47:43+08:00
kind:
  type: problem
  state: open
promotions: []
---
# Fixed activation mistakes legacy recovered lease receipts for live ownership

## Observation

The first fixed-image activation on `ctrdh-studio` found an old watchdog journal with 104 lease entries. Every lease was `state=recovered`; reservations, queue, builds, containers, and setup-prefix operations were empty. Both activation and its fixed-image provisioner still rejected the journal as non-drained.

## Root cause

The legacy transient watchdog retained recovered lease receipts in the durable `leases` map. Current recovery code retires those entries, but activation's `assert_journals_drained` and the provisioner's separate `assert_drained` each treated any non-empty lease map as live ownership. Fixing only the outer gate therefore moved the same false rejection into provisioning.

## Fix

At both activation and provisioning gates, treat a well-formed lease map containing only explicit `recovered` terminal receipts as drained. Unknown lease shapes and every non-recovered state remain fail-closed, as do reservations, queue entries, builds, containers, and setup-prefix operations.

## Verification state

Open until the corrected activation accepts the unchanged legacy journal, the fixed store and watchdog come online, and a real downstream dogfood run completes. Per the current user direction, no automated E2E suite is being run.
