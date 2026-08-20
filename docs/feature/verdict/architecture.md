# Verdict 与 AssertionResult

Verdict 是 read-side 对一个 Attempt 的 Core `outcome`、sealed Assertions 和显式 skip 的确定性折叠。它只在读取这些源事实时产生，不单独保存。

## 四态折叠

Pass Eval 与 Score Eval 的每个 Attempt 都按同一优先级写入一个 Verdict：

| 优先级 | 条件 | Verdict |
|---|---|---|
| 1 | execution error，或 required Assertion unavailable / errored | `errored` |
| 2 | 任一 gate 的 sealed condition 不满足 | `failed` |
| 3 | 显式 `t.skip(reason)`，且没有更高优先级条件 | `skipped` |
| 4 | 其余情形 | `passed` |

Verdict 不从最后一个 Turn、当前源码或 score 值猜测。`errored` 表示无法完成 execution 或必要材料；`failed` 表示已经取得不满足 gate 的事实。页面必须保留相应 Assertion 或 diagnostic，不能只显示四态词。

严格模式可以把明确带 threshold 的 soft condition 作为 gate 参加本次 fold。它不改变 sealed Assertion result、points 或 score state，也不自动停止作者控制流。

## Score Eval 的 Assertion score facts

Score Eval 把 earned score 与 `complete`、`partial` 或 `unavailable` 保存在 sealed Assertion facts 中：

| 情形 | Verdict | Assertion score facts |
|---|---|---|
| 所有 points contribution 可算，gate failed | `failed` | `complete`，保留 earned score。 |
| execution error 在部分贡献封口后发生 | `errored` | `partial`，保留可审计下界。 |
| required score source 不可用且没有可审计 earned 数值 | `errored` | `unavailable`，不伪造零分。 |
| 显式 skip | `skipped`，除非更高优先级条件 | 已封口贡献照实保存，并标明 complete、partial 或 unavailable。 |

`points` 只是 Assertion 的分值／计算单位。`evaluationKind` 是当前 Eval 定义的输入。Verdict 不按分数折叠，score 也不从 Verdict 派生。

## 唯一 owner 与读时失败

Core Attempt 是 execution outcome 的唯一 owner，固定 `niceeval.assertions` family（envelope `schemaVersion: 1`）是 assertion result 与 score facts 的唯一 owner。Diagnostics 属于固定 Observability；其它固定 families 仍各自拥有 file changes、sources 与 artifacts。它们共同构成读取 Verdict 所需的固定 owner。

折叠前必须能读取 Core Attempt 和 sealed Assertions。任一非 available 的 Assertions 读取状态都不是领域 Verdict，也不能被替换成 `passed`；planner 必须形成 gap。`errored`、`cancelled` 与 `interrupted` Attempt 也必须按其真实 Core outcome 折叠，不能由 assertions 洗成 `passed`。

## Planner 与 Reports

reuse planning 从 frozen `RecordWriteSession.view` 读取 Core Attempt、Assertions 和 Observability。它以同一折叠得到 `passed` 或 `failed` 后，才可继续比较 Core combined execution identity 与真实 Observability duration；缺失、partial、unsupported 或 invalid timing 一律不能采用。

Reports 通过声明的读模型显示由相同源事实折叠的 Verdict、相关 Assertion、Score 与 diagnostic，并将已取得的值写成闭合的 `niceeval.report-document/v1`。它经公开读取面取得事实，而不是猜测 execution outcome。

## 相关阅读

- [Assertions 架构](../assertions/architecture.md)
- [Score Eval](../assertions/library/score-points.md)
- [RecordAttachment](../record/architecture.md#recordattachment-与完整-blob-closure)
- [缓存与携带](../experiments/cache.md)
