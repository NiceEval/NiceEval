---
format: niceeval.memory/v1
id: formal-evidence-paths-do-not-prove-runner-provenance
title: Formal evidence paths do not prove runner provenance
createdAt: 2026-08-29
kind:
  type: problem
  state: open
promotions: []
---
## Observation

`pnpm run repo docs test regression add` accepts caller-selected `--red`, `--green`, and `--certificate` file paths. Each JSON document can recompute its own digest, so field consistency does not prove that the root runner created or still owns the artifact.

## Root cause

Formal evidence has schemas and digest checks but no managed local identity. The relation command therefore treats filesystem paths as provenance and copies those files into tracked evidence.

## Required closure

Have root-runner red and takeover commands save their completed artifact sets behind Git-private opaque IDs. Make `regression add` accept only those IDs, resolve the complete set internally, bind candidate bytes and runner receipts, and reject stale or missing managed evidence. Do not add a compatibility reader for arbitrary paths.
