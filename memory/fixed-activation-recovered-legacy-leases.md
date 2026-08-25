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

The first fixed-image activation on `ctrdh-studio` found an old watchdog journal with 104 lease entries. Every lease was `state=recovered`; reservations, queue, builds, containers, and setup-prefix operations were empty. Activation still rejected the journal as non-drained.

## Root cause

The legacy transient watchdog retained recovered lease receipts in the durable `leases` map. Current recovery code retires those entries, but `assert_journals_drained` treated any non-empty lease map as live ownership. This made a safe legacy-to-fixed takeover impossible without rewriting the journal.

## Fix

Treat a well-formed lease map containing only explicit `recovered` terminal receipts as drained. Unknown lease shapes and every non-recovered state remain fail-closed, as do reservations, queue entries, builds, containers, and setup-prefix operations.

## Verification state

Open until the corrected activation accepts the unchanged legacy journal, the fixed store and watchdog come online, and a real downstream dogfood run completes. Per the current user direction, no automated E2E suite is being run.
