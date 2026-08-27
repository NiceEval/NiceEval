---
format: niceeval.docs-node/v1
kind: feature
relations: {}
---

# Inspection

Inspection 通过固定 operation 读取并解释已封存 Record 事实。每个 operation 把 selection、
已封口 cutoff 与业务聚合关闭为可复现的结果；它不是开放给调用方的存储查询层。

```text
sealed Record → shared fixed Inspection operation
              ├── node:sqlite adapter → niceeval query | niceeval show
              └── sqlite-wasm adapter → Insight View
```

## `query` 与 `show` 承接的查看结果

`niceeval query` 把固定结果交付给 Agent 和自动化，只输出机器 JSON。
`niceeval show` 是同一批固定 Inspection operation 的一等英文终端读面，面向人的快速审阅和逐项下钻。
它只格式化已关闭的 result，不建立第二个 selection、聚合或证据语义。

| 用户要查看什么 | 固定 query 怎样承接 |
| --- | --- |
| 默认 Overview 与 Experiment × Eval 结果 | `overview.get` 一次交付各 cell 的成员、分母、Verdict tally、pass rate、score、coverage 和可下钻 Attempt locator；Insight Overview 呈现同一结果。 |
| 已封口 Run 的范围、层级和概览 | `runs.list`、`run.get` 与 `run.summary` 读取 Run、Attempt、Verdict、score、coverage、usage 和已知限制。 |
| 一个精确 Attempt 的依据与调试事实 | `attempt.get` 交付首页、Assertion 索引与可用 section，`attempt.assertion.detail` 按 `entryId` 交付一项完整 check、decision、matcher 与 source ledger；`attempt.trace` 交付有界 execution outline，`attempt.trace.detail` 再按 `itemId`、`toolOccurrenceId` 或 `commandId` 读取一项已封存详情；`attempt.diff`、`attempt.sources` 与 `attempt.artifacts` 读取其它 Evidence。 |
| 收窄查看范围 | 每个 operation 的穷尽 request 只接受其声明的 Run、Attempt 或 comparison selection；`--record` 只选 source，不能成为筛选条件。 |
| 两组 Run 的质量与成本 | `runs.compare` 以 `side-by-side`、`exact` 或 `paired` 返回成员、分母、missing、Evidence 与可比性。 |
| 一个请求会读取什么、怎样解释 | `discover` 给出可问的 operation；`explain` 给出 source、selection、comparison mode 与 fact kinds；`run` 给出同一语义下的结果。 |

machine protocol 始终保留 selection audit、denominator、limits、issues 与 Evidence。
Human renderer 只能在这些闭合值上排序、控制宽度和选择文字布局，不得重算业务判断。

## 固定 query 边界

Inspection catalog 只接受具名 operation 与其穷尽 request/result。它涵盖 Overview、Run、Attempt、比较、
Assertion detail、`sources`、trace outline/detail、diff、artifacts、diagnostics，以及 score、coverage 和 usage 等已封存事实。
调用方不能提交 SQL、JSON path、公式或临时统计。

唯一业务入口是 browser-neutral `selectInspectionOperation(facts, operation)`。
Node 的 `node:sqlite` source adapter 和浏览器的 `sqlite-wasm` source adapter 各自拥有打开与关闭 lifecycle，
并把 pinned facts 交给它。

它们不得各自建立 Node-only projection、浏览器 DTO 或第二套聚合。`facts.ts` 是所有 operation 共用的唯一
facts reader。每次读取先确定 source、selection 和 exact sealed cutoff，再交付带 limits、issues 与 Evidence 的结果。
任何 consumer 都不能重选成员、补配结果，或从标量重新计算业务聚合。

人读浏览器体验、语言与 Preview 由 [Insight](../insight/README.md) 拥有。它在完整
`RecordSnapshot` 上经 sqlite-wasm 调用同一固定 query definition；组件不写 SQL，也不从 raw runs
猜算事实。Inspection 不拥有 View UI、Snapshot transport、session、Preview 或 Playground 写入。

- [Architecture](architecture.md)
- [CLI](cli.md)
- [Use cases](use-case/README.md)
