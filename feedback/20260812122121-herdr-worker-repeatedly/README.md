---
format: niceeval.feedback/v2
id: 20260812122121-herdr-worker-repeatedly
title: Herdr worker repeatedly receives unrelated user steers
state: open
reportedAt: 2026-08-12T12:21:21+08:00
source:
  kind: dev
  repository: NiceEval/NiceEval
subject: dependency
claim: friction
observation: |
  ---
  title: 'Herdr worker repeatedly receives unrelated user steers'
  severity: 'minor'
  ---

  ## Expected Behavior

  Only prompts explicitly addressed to a Herdr worker should steer or interrupt that worker.

  ## Current Behavior

  A read-only design_grill worker repeatedly received unrelated prompts such as `Summarize recent commits` and `Find and fix a bug in @filename`. Each prompt interrupted the active review.

  ## Possible Solution

  Route user steers only to the active parent pane unless the target worker is explicitly addressed.

  ## Minimal Reproducible Example

  1. Start a Herdr Codex worker in a sibling pane.
  2. Prompt it with a long read-only review.
  3. While it is working, inspect `herdr agent read <name>`.
  4. Observe unrelated user prompts entering and interrupting the worker every roughly 30 seconds.

  ## Context

  The parent had to interrupt, resume, and restart the design reviewer. Even a requested one-word final verdict was repeatedly interrupted before eventually returning PASS.
impact: A read-only design_grill worker repeatedly received unrelated prompts such as `Summarize recent commits` and `Find and fix a bug in @filename`. Each prompt interrupted the active review.
memoryRelations: []
adoptions:
  current: []
  history: []
---
---
title: 'Herdr worker repeatedly receives unrelated user steers'
severity: 'minor'
---

## Expected Behavior

Only prompts explicitly addressed to a Herdr worker should steer or interrupt that worker.

## Current Behavior

A read-only design_grill worker repeatedly received unrelated prompts such as `Summarize recent commits` and `Find and fix a bug in @filename`. Each prompt interrupted the active review.

## Possible Solution

Route user steers only to the active parent pane unless the target worker is explicitly addressed.

## Minimal Reproducible Example

1. Start a Herdr Codex worker in a sibling pane.
2. Prompt it with a long read-only review.
3. While it is working, inspect `herdr agent read <name>`.
4. Observe unrelated user prompts entering and interrupting the worker every roughly 30 seconds.

## Context

The parent had to interrupt, resume, and restart the design reviewer. Even a requested one-word final verdict was repeatedly interrupted before eventually returning PASS.
