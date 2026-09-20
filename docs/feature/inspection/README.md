---
format: concord.document/v1
id: inspection
title: Inspection
createdAt: 2026-08-26T19:54:36+08:00
kind: feature
---

# Inspection

Inspection 通过固定 operation 读取并解释已发布 Run 与 Attempt 事实。当前项目 operation 还消费 Experiment Host
冻结的目标及适用性输入。每个 operation 把 selection、`PublicationCutoff` 与业务聚合关闭为可复现的结果。

```text
Run facts at PublicationCutoff → shared fixed Inspection operation
                              ├── Node adapter → niceeval query | niceeval show
                              └── browser adapter → Insight View
```

## `query` 与 `show` 承接的查看结果

`niceeval query` 把固定结果交付给 Agent 和自动化，只输出机器 JSON。
`niceeval show` 是同一批固定 Inspection operation 的一等英文终端读面，面向人的快速审阅和逐项下钻。
它只格式化已关闭的 result，不建立第二个 selection、聚合或证据语义。

| 用户要查看什么 | 固定 query 怎样承接 |
| --- | --- |
| 当前项目还缺哪些结果 | `project.get` 一次交付当前目标分母、covered、gap、旧结果入口及可用成员的质量指标；默认本机 Show 与 View 呈现同一结果。 |
| 历史 Results 与 Experiment × Eval 结果 | `overview.get` 一次交付历史各 cell 的成员、分母、Verdict tally、pass rate、score、USD cost、coverage 和可下钻 Attempt locator。 |
| 一个精确 Experiment 的概览 | `experiment.get` 在 Inspection 内按 exact `experimentId` 选择，交付该 Experiment 的 aggregate、Eval cells 与 Attempt locators。 |
| 一个 Run 的概览 | `run.get` 按 exact `runId` 一次关闭 state、时间、expected/published/missing、pending/absence、slot binding、Verdict、score、coverage、usage 与 limitations；`run.list` 承接分页发现。 |
| 一个精确 Attempt 的依据与调试事实 | `attempt.get` 交付身份、outcome、Verdict、score、Assertion 摘要、Evidence coverage 与 section 状态。`attempt.sources`、`attempt.trace`、`attempt.timing`、`attempt.usage` 和 `attempt.diff` 交付各固定切片。 |
| execution 中的一项已发布详情 | `attempt.trace.detail` 按 `itemId`、`toolOccurrenceId` 或 `commandId` 读取一项详情；`attempt.assertion.detail` 按 `entryId` 交付一项 Assertion 调试依据。 |
| 收窄查看范围 | 每个 operation 的穷尽 request 只接受其声明的 Experiment、Run、Attempt 或 comparison selection。 |
| 两组 Run 的质量与成本 | `runs.compare` 以 `side-by-side`、`exact` 或 `paired` 返回成员、分母、missing、Evidence 与可比性。 |
| 一个请求会读取什么、怎样解释 | `discover` 给出可问的 operation；`explain` 给出 source、selection、comparison mode 与 fact kinds；`run` 给出同一语义下的结果。 |

machine protocol 始终保留 selection audit、denominator、limits、issues 与 Evidence。
Human renderer 只能在这些闭合值上排序、控制宽度和选择文字布局，不得重算业务判断。

## 固定 query 边界

Inspection catalog 只接受具名 operation 与其穷尽 request/result。它涵盖 Results 所用的 `overview.get`，以及 Experiment 和 Run。
它也涵盖 Attempt、比较、Assertion detail、sources、execution outline/detail、timing、usage、diff、artifacts 和 diagnostics 等已发布事实。
调用方不能提交 SQL、JSON path、公式或临时统计。

Inspection 是已发布事实与 Delivery 之间的中间结果 owner。`run.get` 之类的闭合 result 在
pinned facts 与 exact `PublicationCutoff` 上即时形成，不写回 Run、不另建派生表或 query cache。

固定历史业务入口是 browser-neutral `selectInspectionOperation(facts, operation)`。
`project.get` 同时消费 Experiment Host 为当前 generation 形成的冻结输入，失败时不降级为历史结果。
Node CLI 与 Insight Host 各自拥有打开与关闭 lifecycle，并把 pinned facts 交给同一个 result owner。

它们不得各自建立 Node-only projection、浏览器 DTO 或第二套聚合。`facts.ts` 是所有 operation 共用的唯一
facts reader。每次读取先确定 selection 和 exact `PublicationCutoff`，再交付带 limits、issues 与 Evidence 的结果。
任何 consumer 都不能重选成员、补配结果，或从标量重新计算业务聚合。

人读浏览器体验、语言与 Preview 由 [Insight](../insight/README.md) 拥有。它在一个 View generation 的
`PublicationCutoff` 上调用同一固定 query definition；当前 Results 还绑定 target identity。组件不写 SQL，也不从 raw rows 猜算事实。

- [Architecture](architecture.md)
- [CLI](cli.md)
- [Use cases](use-case/README.md)
