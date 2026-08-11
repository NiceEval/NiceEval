# Assertions

Assertion 是一次 Attempt 内已经完成、可离线复核的检查事实。值比较、scope 检查、Sandbox 验证、资源限制和 Judge 都归一到同一个 Attempt-owned `RecordAttachment`：`niceeval.assertions/v1`。

它保存当时检查了什么、基于什么材料得出了什么结果；它不决定 Attempt 的生命周期，也不替代 [Verdict](../verdict/README.md)。producer 在整个 Run 发布前封口这份 Attachment，Record 与 Report 只读取已封口的事实。

## Assertions v1 持久化什么

每个 entry 都有仅在本 Attempt Assertions Attachment 内稳定的 `entryId`。它是详情、路由与导航的 identity，不从名称、数组位置、源码位置或证据内容推导，也不承诺跨 Attempt 相同。

| 字段组 | 必须保存的事实 |
|---|---|
| identity 与顺序 | 稳定 `entryId`，以及原始声明／展示顺序。 |
| criterion | 一个封闭的内建 criterion，或精确的第三方 `{ name, schemaId, data }` criterion。 |
| material | 有界的 subject snapshot 或稳定 ref，以及有界 evidence refs 或预览。 |
| completeness | coverage、redaction、sampling、truncation 等 limitations。 |
| outcome | 已封口的 evaluation、result、可用性和具名原因。 |
| display | 作者给出的 key、label 与 groupPath。 |
| score unit | sealed score contribution 中的 `points` 与 earned 值；它是分值单位，不是题型。 |

内建 criterion 是包定义的封闭判别联合，例如值比较、scope 状态、事件 occurrence、Judge measurement 和 Sandbox result。第三方 criterion 只能以自己的 `name`、版本化 `schemaId` 与 exact JSON `data` 表示；它不能冒充内建成员。

`subject` 与 `evidence` 只保存安全快照，或本 Assertions Attachment 自己 closure 中的 blob ref。v1 不携带另一个 Attachment 的 `RecordBlobRef`、path 或“最新状态”引用。二者都受条目数、ref 数、预览大小和 document 大小的固定上限约束。coverage 与 limitations 必须随材料保存，不能由 reader 事后猜测。

## 不写入的运行时细节

作者调用图、evaluator 内部实现、memoization、求值控制流、未执行的源码和当前 worktree 都不属于 `niceeval.assertions/v1`。它们可以变化；只要已保存 criterion、材料、coverage 与 sealed result 的含义不变，Assertions Attachment 不变。

`.orStop()`、`stopOnFailure` 和 detached async 都只影响 producer 执行。它们不是 entry 事实，也不会凭空产生 `notReached` 条目或补零。

## entry 局部隔离

Attachment 的 framing、`entryId` 唯一性、顺序和边界必须有效。内建 criterion 未知、第三方 schema 未安装，或 criterion 的 `data` 不符合其 schema 时，reader 仅把该 entry 标成 `unsupported` 或 `invalid`，保留其余 entry 可读。

因此单一第三方检查不能拖垮同一 Attempt 的其它 Assertion、Verdict 或已声明的 Projection。只有无法建立 entry 边界、重复 `entryId`、超出全局限制或 envelope 损坏时，整个 Attachment 才是 invalid。

## Pass Eval 与 Score Eval

两种 Eval 的每个 Attempt 都有四态 Verdict：`passed`、`failed`、`errored` 或 `skipped`。`evaluationKind` 只取 `pass | score`，由 Eval factory 产生并保存在 Run-owned Evaluation Attachment。

Pass Eval 的主要读数是 Verdict。Score Eval 同时写入独立的 `niceeval.score/v1` Attachment；它的主要读数是 earned score，而 Verdict 继续准确说明 execution、gate 与 skip 的终态。

`points` 只是 Assertion 的分值或 score 计算单位。gate failed 会使 Verdict 为 `failed`，却不会抹掉已 earned 的 score；execution error 与 unavailable score source 的完整关系由 [Score Eval](library/score-points.md) 定义。

## 作者入口

作者仍在观察结果的位置登记 Assertion：

```ts
t.check(turn.message, includes("已完成"))
  .key("reply-complete")
  .label("说明已完成");

const turn = await t.send("搜索资料并说明结论。");
turn.succeeded().label("Turn 完成");
turn.calledTool("search").label("调用搜索工具");
turn.judge.autoevals.closedQA("回答质量").atLeast(0.8);
```

`t.check` 只接收 `(value, match)`。scope 方法与 Judge recipe 已经登记同一种 Assertion；handle 只配置该 entry，不能登记第二条检查。

Score Eval 使用 `handle.score(points)` 或 `t.score(points)` 写明贡献。后者仍形成一个 Assertions entry，criterion 为内建 direct-score，而不是不透明的分数旁路。需要 Verdict 条件时，Score Eval 显式声明 gate；分数贡献和 gate 是正交事实。

完整字段、封口、边界与 Projection 规则见 [Architecture](architecture.md)。

## 继续阅读

- [Library](library.md) —— 作者 API 和 handle 配置。
- [Value assertions](library/value-assertions.md) —— Match 与 refinement。
- [Scoped assertions](library/scoped-assertions.md) —— scope snapshot 与 `succeeded`。
- [Score Eval](library/score-points.md) —— score、gate 与可用性。
- [Evidence](architecture/evidence.md) —— snapshot、refs 与完整度。
- [Verdict](../verdict/README.md) —— 每个 Attempt 的四态折叠。
