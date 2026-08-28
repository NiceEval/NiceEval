---
format: niceeval.memory/v1
id: issue-no-cli-owner
title: Issue lifecycle has no named CLI owner
createdAt: 2026-08-28
kind:
  type: problem
  state: open
promotions: []
---
Issue preparation and remote lifecycle actions need a named CLI owner to consistently enforce authorization, deduplication, and retry safety.

A plan-execute boundary is required before remote mutation.
