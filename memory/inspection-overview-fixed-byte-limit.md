---
format: niceeval.memory/v1
id: inspection-overview-fixed-byte-limit
title: Large published Overviews fail Inspection
createdAt: 2026-09-01
kind:
  type: problem
  state: open
promotions: []
---
## Problem

A project with a legitimate published result matrix can make `niceeval show` and `overview.get` fail even though exact Run inspection succeeds. MemoryBench reproduced this with 180 selected slots: the public machine Overview was about 975 KiB, while Inspection rejected every Overview larger than 512 KiB.

## Root cause

`selectInspectionOverview` closes the complete fixed result and then incorrectly applies the 512 KiB budget intended for bounded detail projections. Overview is the required one-shot index for all selected Experiment × Eval × ordinal slots and repeats closed refs and coverage at cell, group, Experiment, and total aggregates. A normal benchmark therefore crosses the detail-oriented limit without corrupt or incomplete Record facts.

## Fix

Remove the detail-projection byte limit from the complete Overview result while preserving strict decoding. Sources, trace, and other content-heavy detail projections retain their bounded output rules; Preview retains its separate transport limit. The Show E2E generates a deterministic Overview larger than 512 KiB through installed public `exp`, verifies the machine result is complete, then requires the same installed `show` entry to render it successfully.

## 2026-09-05 证据审计

当前 show Journey 已包含超过 512 KiB 的 overview 公开输入，并且后续增加 score-only 与 folded display 断言，当前文件 digest 与历史 fixed 收据不同。已通过 managed reopen 撤销过期 fixed 声明，保留历史和同一结果的 regression 关系；需当前源码的适用红灯与完整接管。
<!-- niceeval.memory-resolution-history/v1 -->

### Reopened at `5a1bc84e8944350574f07553b21ff61cbbd70f0a`

```json
{
  "kind": "fixed",
  "proof": [
    "nered_108H8RGQ1RGRRNKW",
    "netake_MSCB4EXBKKC1A1CH",
    "niceeval.fixed-evidence/v1:{\"selectors\":[\"e2e/inspection/test/show-cli.test.ts#necase_9FHHSQTVB492P8DS\"]}"
  ]
}
```
