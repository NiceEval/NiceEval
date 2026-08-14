# Verdict 与 AssertionResult

Verdict 是 producer 根据一个 Attempt 的 sealed Assertion result、execution outcome 和显式 skip 形成的 Attempt-owned `RecordAttachment`。名称是 `niceeval.verdict`，payload schema 是 `niceeval.verdict/v1`；它是独立业务事实，不是 reader 的计算副本。

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

## Score Eval 的独立 Score Attachment

Score Eval 在 Verdict 之外写 `niceeval.score/v1`。Attachment 保存 earned score 与 `complete`、`partial` 或 `unavailable`：

| 情形 | Verdict | Score Attachment |
|---|---|---|
| 所有 points contribution 可算，gate failed | `failed` | `complete`，保留 earned score。 |
| execution error 在部分贡献封口后发生 | `errored` | `partial`，保留可审计下界。 |
| required score source 不可用且没有可审计 earned 数值 | `errored` | `unavailable`，不伪造零分。 |
| 显式 skip | `skipped`，除非更高优先级条件 | 已封口贡献照实保存，并标明 complete、partial 或 unavailable。 |

`points` 只是 Assertion 的分值／计算单位。`evaluationKind` 只来自 Run-owned `niceeval.evaluations/v1`，值只有 `pass` 或 `score`。Verdict 不按分数折叠，score 也不从 Verdict 派生。

## RecordAttachment 数据

```ts
type VerdictStateV1 = "passed" | "failed" | "errored" | "skipped";

type VerdictPayloadV1 = {
  readonly state: VerdictStateV1;
};
```

`niceeval.verdict/v1` 的 exact payload 只有四态 `state`。Assertion、diagnostic ref、人读摘要与 Score 都属于
各自的业务 Attachment，不进入 Verdict。`niceeval.eligibility/v1` 的 exact payload 由
[Reuse planning](../experiments/cache.md#executiontarget-的形成) 唯一拥有：它的 `reuseContract`、identity 与
execution duration 是资格领域值，不是 Verdict 字段。

`RecordAttachmentRead` 的 state 描述该 Attachment 是否取得：只有 `available` 同时给出 exact decoded payload 与
完整 own blob closure。`unavailable`、`migration-required`、`migration-unavailable`、`unsupported` 与 `invalid`
都不是领域 Verdict，也不能被替换成 `passed`。

被请求的 Verdict Attachment 为 `invalid` 时，planner 形成对应 gap，依赖它的 Projection 显示 read state；其它
非-available state 也不允许采用。Verdict 的领域状态仍只有上面的四态；eligibility 的领域比较只在它自己的
Attachment read 为 available 后进行。

payload、own blob closure 语义或解释改变时，发布同名的相邻 `RecordAttachmentSchemaId`。family 必须提供精确
converter 或 `not-losslessly-migratable` edge；普通 reader 不自动迁移，也不补默认值或重算 Verdict。

## Planner 与 Reports

reuse planning 从 frozen `RecordWriteSession.view` 读取 Verdict 与 eligibility。两份 `RecordAttachmentRead` 都必须为
`available`，此时才有 exact payload 和完整 own closure。

随后 Verdict 的领域 state 必须是 `passed` 或 `failed`。eligibility 的 schema、`reuseContract`、identity、duration
与本次 policy 也必须满足，planner 才可采用 Attempt。

Reports 通过声明的 `RecordProjection` 显示 Verdict、相关 Assertion、Score 与 diagnostic，并将已取得的值写成闭合的 `niceeval.report-document/v1`。它不打开 Record 文件、不重新折叠 Verdict，也不猜 strict policy、控制流或缺失材料。

## 相关阅读

- [Assertions 架构](../assertions/architecture.md)
- [Score Eval](../assertions/library/score-points.md)
- [RecordAttachment](../record/architecture.md#recordattachment-与完整-blob-closure)
- [缓存与携带](../experiments/cache.md)
