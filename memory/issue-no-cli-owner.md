---
format: concord.document/v1
id: issue-no-cli-owner
title: Issue lifecycle has no named CLI owner
createdAt: 2026-08-28
kind: memory
memoryKind: problem
state: open
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
---
Issue preparation and remote lifecycle actions need a named CLI owner to consistently enforce authorization, deduplication, and retry safety.

A plan-execute boundary is required before remote mutation.
