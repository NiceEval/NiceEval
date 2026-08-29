---
format: niceeval.memory/v1
id: show-experiment-heading-detached-from-table
title: Show Experiment heading is detached from its table
createdAt: 2026-08-28
kind:
  type: problem
  state: resolved
  resolution:
    kind: fixed
    proof:
      - "red: /tmp/niceeval-e2e-artifacts-3e5UZr/report/receipt.json"
      - "green: /tmp/niceeval-e2e-artifacts-N2KVHv/report/receipt.json"
promotions: []
---
## Problem

`niceeval show` renders each `Experiment <id>` heading with a blank line after it before the `Eval / Attempt / Score` table. The heading is therefore visually closer to the preceding Experiment table than to the table it owns.

## Root cause

The shared terminal block renderer inserts spacing before every non-divider block even when the preceding block is a divider. The Show Overview represents an Experiment heading as a divider followed by its table, so the generic spacing rule separates the heading from its owned table.

## Expected resolution

The installed CLI must render a blank line before each subsequent Experiment section, then place `Experiment <id>` immediately adjacent to its following `Eval / Attempt / Score` table header. Other panels and non-divider block spacing must remain unchanged.
