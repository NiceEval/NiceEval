---
format: concord.document/v1
id: guidance-stale
title: Guidance can become stale after repository rules change
createdAt: 2026-08-28
kind: memory
memoryKind: problem
state: open
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
---
Runtime guidance can be presented from a stale AGENTS or Skill snapshot after HEAD or rule files change.

Affected actions need a fresh preflight tied to the current authority before they proceed.
