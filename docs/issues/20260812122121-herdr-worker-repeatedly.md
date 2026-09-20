---
format: concord.document/v1
id: 20260812122121-herdr-worker-repeatedly
title: Herdr worker repeatedly receives unrelated user steers
createdAt: 2026-08-12T12:21:21+08:00
kind: issue
state: draft
memoryRelations: []
adoptions:
  current: []
  history: []
origin:
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
history:
  - at: 2026-09-14T15:00:25.173Z
    action: migrate
    reason: Transferred the existing observation to its current Issue owner.
    source:
      path: feedback/20260812122121-herdr-worker-repeatedly/README.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:4c7121c17e07a1a3397e41f96fca93ff203098d32cdf18334a3b7cf09e90aee5
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
