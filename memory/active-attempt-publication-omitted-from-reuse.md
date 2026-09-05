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

## 2026-09-05 证据审计

当前 record Journey 已增加运行中 show、SIGKILL recovery、reuse 与 deletion 的公开断言，当前文件 digest 与历史 fixed 收据不同。已通过 managed reopen 撤销过期 fixed 声明，保留同一用户结果的 regression 关系与历史。需要对当前源码重新取得适用红灯和完整接管后才能再次 fixed。
<!-- niceeval.memory-resolution-history/v1 -->

### Reopened at `5a1bc84e8944350574f07553b21ff61cbbd70f0a`

```json
{
  "kind": "fixed",
  "proof": [
    "nered_C13Y7ZVPD8B4ZH6K",
    "netake_CDTTWCPNFNCRX0MY",
    "niceeval.fixed-evidence/v1:{\"selectors\":[\"e2e/record/test/record-journey.test.ts#necase_H632V0FG1N2KEBJ5\"]}"
  ]
}
```
