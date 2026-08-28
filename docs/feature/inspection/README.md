---
format: niceeval.docs-node/v1
kind: feature
relations: {}
---

# Inspection

Inspection 通过固定 operation 读取并解释已封存 Record 事实。每个 operation 把 selection、
已封口 cutoff 与业务聚合关闭为可复现的结果；它不是开放给调用方的存储查询层。

```text
sealed Record → shared 16-operation typed registry
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
| 一个精确 Experiment 的概览 | `experiment.get` 在 Inspection 内按 exact `experimentId` 选择，交付该 Experiment 的 aggregate、Eval cells 与 Attempt locators。 |
| 已封口 Run 的人读概览 | `run.overview` 按 exact `runId` 一次关闭 Run/Experiment identity、时间、expected/observed denominator、Member state/locator/origin relation、Verdict、score、coverage、usage 摘要与 limitations；`run.get`、`run.summary` 与 `runs.list` 继续承接 machine 读取与分页发现。 |
| 一个精确 Attempt 的依据与调试事实 | `attempt.get` 交付身份、outcome、Verdict、score、Assertion 摘要、Evidence coverage 与 section 状态。`attempt.sources`、`attempt.trace`、`attempt.timing`、`attempt.usage` 和 `attempt.diff` 交付各固定切片。 |
| execution 中的一项已封存详情 | `attempt.trace.detail` 按 `itemId`、`toolOccurrenceId` 或 `commandId` 读取一项详情；`attempt.assertion.detail` 按 `entryId` 交付一项 Assertion 调试依据。 |
| 收窄查看范围 | 每个 operation 的穷尽 request 只接受其声明的 Experiment、Run、Attempt 或 comparison selection；`--record` 只选 source，不能成为筛选条件。 |
| 两组 Run 的质量与成本 | `runs.compare` 以 `side-by-side`、`exact` 或 `paired` 返回成员、分母、missing、Evidence 与可比性。 |
| 一个请求会读取什么、怎样解释 | `discover` 给出 `outcome: discovery` 的 operation catalog；`explain` 给出 `outcome: explanation` 的 source、selection、comparison mode 与 fact kinds；`run` 以 `outcome: success | failure` 交付结果。 |

machine protocol 始终保留 selection audit、denominator、limits、issues 与 Evidence。
Human renderer 只能在这些闭合值上排序、控制宽度和选择文字布局，不得重算业务判断。

## 固定 query 边界

Inspection catalog 只接受具名 operation 与其穷尽 request/result。它涵盖 Overview、Experiment、Run、Attempt、比较、
Assertion detail、sources、execution outline/detail、timing、usage、diff、artifacts 和 diagnostics 等已封存事实。
调用方不能提交 SQL、JSON path、公式或临时统计。

Inspection 是 SQLite 封存事实与 Delivery 之间的中间结果 owner。SQLite 继续只持久化 Run、Slot、Member、Attempt、
Attachment 等事实。`run.overview` 之类的闭合 result 在 pinned facts 与 exact sealed cutoff 上即时形成，不能写回
Record，也不能另建派生表、query cache 或人读 artifact。

唯一公开 Library 入口是纯跨运行时的 `niceeval/inspection`。它导出 16-operation typed registry，以及由该
registry 派生的 request/document Schema、类型、descriptor、完整 decoder 与按 operation 语义窄化函数。
不存在 `inspection/host`、alias、fallback 或 Node 专用公开入口。

Node 的 `node:sqlite` source adapter 和浏览器的 `sqlite-wasm` source adapter 各自拥有打开与关闭 lifecycle，
并把 pinned facts 交给内部 selector。source、select、SQLite 与 Record 读取不属于公开协议入口。

它们不得各自建立 Node-only projection、浏览器 DTO 或第二套聚合。内部 facts reader 仍是所有 operation 的
唯一读取面。每次读取先确定 source、selection 和 exact sealed cutoff，再交付带 limits、issues 与 Evidence 的结果。
任何 consumer 都不能重选成员、补配结果，或从标量重新计算业务聚合。

人读浏览器体验、语言与 Preview 由 [Insight](../insight/README.md) 拥有。它在完整
`RecordSnapshot` 上经 sqlite-wasm 调用同一 registry operation；组件不写 SQL，也不从 raw runs
猜算事实。Inspection 不拥有 View UI、Snapshot transport、session、Preview 或 Playground 写入。

- [Architecture](architecture.md)
- [CLI](cli.md)
- [Use cases](use-case/README.md)
