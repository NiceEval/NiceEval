---
format: niceeval.memory/v1
id: active-attempt-publication-omitted-from-reuse
title: Active Attempt publication is omitted from default Inspection and reuse
createdAt: 2026-09-01
kind:
  type: problem
  state: open
promotions: []
---
## Problem

An Experiment can publish a completed Attempt while its origin Run remains active. `niceeval run show` and an exact machine Inspection query can read that publication, but the default human `niceeval show` overview and the next Invocation's reuse planner omit it. After SIGKILL, the next Invocation reports `reused: 0` and executes the already paid-for ordinal again.

## Root cause

Run publication revision 2 records `run_resources`, `attempt_publications`, and slot bindings independently, and exact locator resolution already admits published Attempts from an active origin Run. The sealed Run summary inventory used by default Inspection and `RecordHost.selectRuns()` still enumerates only legacy `runs.status = sealed`. Reuse and default Overview therefore never receive the active Run as a candidate source.

The Attempt publication closure also currently records only origin Run metadata. It does not itself prove and freeze the completed Attempt Core and all Attempt-owned attachment, collection, and content rows, leaving final whole-Run seal as a second integrity authority.

## Repair boundary

Use one revisioned publication inventory for active and terminal Runs. A published Attempt must enter default Inspection and reuse at its publication revision without waiting for Run close. Publication must validate and freeze the complete Attempt-owned fact closure in the same transaction that publishes its identity and origin binding. Run close only freezes terminal state and absence reasons; recovery fences the old writer and preserves already published Attempts.

The installed-package Record Journey must prove active default `show`, automatic carry after SIGKILL, missing-slot-only dispatch, and terminal recovery through public CLI entry points.
