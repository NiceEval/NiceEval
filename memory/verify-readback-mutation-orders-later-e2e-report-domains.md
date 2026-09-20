---
format: concord.document/v1
id: verify-readback-mutation-orders-later-e2e-report-domains
title: verify-readback-mutation-orders-later-e2e-report-domains
createdAt: 2026-07-22T08:50:49+08:00
createdAtSource:
  kind: first-recorded
  path: memory/verify-readback-mutation-orders-later-e2e-report-domains.md
  commit: 031ce196afdc67380ab6ccbeb8308168b74ee9bc
description: verifyReadback 的 verifyHistoryAndPages 在结尾对 .niceeval/main 做 2 次真实 --force/reuse 追加快照，让 evidence.main 的原始 locator 之后就不再是「当前」——晚运行的只读验收域会在 --page traces / ExperimentList 里查不到它
kind: memory
memoryKind: problem
state: captured
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
---

**现象**：`e2e/report/scripts/verify-render-structure.ts`（B3，plan/testing-layer-realignment.md）
在 `e2e.ts` 里排在 `verifyReadback` **之后**调用时，`pnpm e2e --repo report` 真机跑必现：

```
AssertionError: traces page text is missing the --timing drill-down command for @1915y16o
```

`@1915y16o` 正是 `evidence.main.attempts[...]`（`produceEvidence()` 返回的原始 main 快照的
locator），但 `niceeval show --page traces`（读「当前」Scope）里已经找不到它。

**根因**：`verify-readback.ts` 的 `verifyHistoryAndPages` 是全仓唯一会**修改共享
`evidence.resultsRoot`** 的验收段——它自己的头注已经写明「必须排最后」，因为它会额外真实跑
2 次 `niceeval exp main`（一次 `--force` 产生新快照，一次不带 `--force` 走 carry-forward
reuse 又产生一个新快照目录）。`niceeval show`/`view` 的「当前」Scope 只取每个 experiment
**最新**的快照，所以这 2 次额外调用一结束，`main` experiment 的「当前」快照就变成了
`verifyReadback` 自己造的那个，`evidence.main` 里原始 produceEvidence() 快照的 attempts
不再出现在任何读「当前」Scope 的视图（`show --page traces`、`show`裸调用的
ExperimentList/AttemptList 等）里——尽管它们仍然完好地躺在磁盘上。

`evidence.siteExportDir`（`produceEvidence()` 末尾一次性导出的静态站）不受影响，因为它是导
出时刻的快照，后续任何 `.niceeval/` 变化都不会回写进已经生成的 HTML 文件；受影响的只是**在
`verifyReadback` 之后才发起的、任何依赖"当前 Scope"的实时 CLI 调用**（`sh("... niceeval show
...")`）。

**修法**：在 `e2e/report/scripts/e2e.ts` 里，把只读、不修改共享结果根的验收域调用统一放到
`verifyReadback` **之前**（示例：`verifyFormat` → `verifyRenderStructure` → `verifyReadback`）。
`e2e.ts` 顶部"新增 verify-<domain>.ts 调用去这里，顺序随意"的注释对这条边界不成立——凡是会像
`verifyRenderStructure` 一样用 `sh()` 现场跑 `niceeval show`（而不是只读 `evidence.siteExportDir`
里已经落盘的静态文件）去核对 `evidence.main`/`evidence.deliberateFail`/`evidence.deliberateError`
原始 locator 的模块，都必须排在 `verifyReadback` 之前；B4/B5 若也要现场调用 `show`/`view` 核对
main 的原始 attempts，同样适用。

**适用场景**：给 `e2e/report/` 新增/调整 verify-\<domain\>.ts 并接线进 `e2e.ts` 时，先确认自己
是否现场发起任何依赖"当前 Scope"的 CLI 读取；如果是，检查调用顺序是否排在 `verifyReadback`
之前。
