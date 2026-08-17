# Assertions

Assertion 是一次 Attempt 内已经完成、可离线复核的检查事实。值比较、scope 检查、Sandbox 验证、资源限制和 Judge 都归一到 Attempt-owned 的 `niceeval.assertions` family（envelope `schemaVersion: 1`）。producer 在整个 Run 发布前封口它；Record、Verdict 与 Analysis 只读取已封口的事实，不重新执行 matcher 或作者代码。

Record v1 的 durable catalog 有 Assertions、Observability、FileChanges、Source Navigation、Sources 与 Artifacts 六个固定 family。第三方可以提供 Assertion criterion 的解释 schema，却不能增加 family、字段 writer 或自己的持久化通道。完整 catalog、owner 与 closure 规则见 [Record architecture](../record/architecture.md)。

## Assertions v1 持久化什么

每个 entry 都有仅在本 Attempt Assertions Attachment 内稳定的 `entryId`。它是详情与导航的 identity，不从名称、数组位置、源码位置或证据内容推导，也不承诺跨 Attempt 相同。

| 字段组 | 必须保存的事实 |
|---|---|
| identity 与顺序 | 稳定 `entryId`，以及原始声明／展示顺序。 |
| criterion | 一个封闭的内建 criterion，或精确的第三方 `{ name, schemaId, data }` criterion。 |
| material | 有界的 subject snapshot 或稳定 ref，以及有界 evidence refs 或预览。 |
| completeness | coverage、redaction、sampling、truncation 等 limitations。 |
| outcome | 已封口的 evaluation、result、可用性和具名原因。 |
| display | 作者给出的 key、label 与 groupPath。 |
| score unit | sealed score contribution 中的 `points` 与 earned 值；它是分值单位，不是题型。 |
| source navigation | 已执行 source site 的 `entryId`、role、位置与 Sources item join。 |

内建 criterion 是包定义的封闭判别联合，例如值比较、scope 状态、事件 occurrence、Judge measurement 和 Sandbox result。第三方 criterion 只能以自己的 `name`、版本化 `schemaId` 与 exact JSON `data` 表示；它不能冒充内建成员，也不能借此写入另一种 durable family。

`subject` 与 `evidence` 只保存安全快照，或本 Assertions Attachment 自己 closure 中的 blob ref。v1 不携带另一个 Attachment 的 `RecordBlobRef`、path 或“最新状态”引用。二者都受条目数、ref 数、预览大小和 document 大小的固定上限约束。coverage 与 limitations 必须随材料保存，不能由 reader 事后猜测。

## 不写入的运行时细节

作者调用图、evaluator 内部实现、memoization、求值控制流、未执行的源码和当前 worktree 都不属于 Assertions payload。它们可以变化；只要已保存 criterion、材料、coverage 与 sealed result 的含义不变，Assertions 事实不变。

`.orStop()`、`stopOnFailure` 和 detached async 都不改变 entry 的 sealed result，也不会凭空产生 `notReached` 条目或补零。已经执行的 assertion modifier 位置可作为 `sourceSites` row 保存；未执行源码不是持久事实。

## 源码导航

Assertion source site 不是 Source Navigation 的 row。`sourceSites` 仍是 `niceeval.assertions` payload（envelope `schemaVersion: 1`）的一部分。
每一行只用本 Attachment 内的 `entryId` 关联一个已执行、role-tagged 的 source site，并以 `sourceItemId` 与 digest join 到 origin Run 的既有 Sources snapshot。它不复制 criterion、result、points、gate、source path、source blob 或控制流。

一个 entry 有多个 source site 也不形成多条 check 或 score contribution；权威 result 与 points 始终按 `entryId` 只计算一次。Sources 内容仍只属于 `niceeval.sources` family 的 own closure（envelope `schemaVersion: 1`），不能用同 path、digest 或 item identity 假装配对另一个 Run。

Assertion source site 与物理 send navigation 分别由 [Analysis Library](../analysis/library.md) 的 `query()` 以已发布的 `DomainView` 读取。它不会把 Record path、blob capability 或当前 worktree 交给 consumer。没有 matching site、Sources 不能形成可用值，或 join／坐标不能验证时，DomainView 把该位置标为 `unmapped`；这只是视图的局部结果，不能改变 Assertion、Verdict 或 Score。

## family Host 与 entry 局部隔离

Record family Host 对 Assertions 与 Sources 只报告四态：

| state | 含义 |
|---|---|
| `available` | exact payload 和完整 own blob closure 已验证。 |
| `not-recorded` | 该 owner 未写入此固定 family。 |
| `unsupported` | 该 family 或 schema 不属于当前固定 catalog。 |
| `invalid` | envelope、payload、closure 或 family 不变量不能验证。 |

当 Assertions 为 `available` 时，未知内建 criterion、未安装第三方 schema，或 criterion `data` 不符合其 schema，只让对应 entry 显示 `unsupported` 或 `invalid`；其余 entry 继续可读。只有无法建立 entry 边界、重复 `entryId`、超出全局限制或 envelope／closure 损坏时，整个 Assertions family 才是 `invalid`。

entry 的 material coverage 仍可为 `complete`、`partial`、`unavailable` 或 `not-applicable`。这是已经读到 payload 后的领域事实，不是 family Host 的第五种状态。required 材料的不可用会进入 Verdict fold；optional 材料保留事实而不伪造失败。

## Pass Eval 与 Score Eval

每个 Attempt 的 Verdict 都由 Core outcome、sealed Assertions 与显式 skip 在读侧确定性折叠为 `passed`、`failed`、`errored` 或 `skipped`。它不是独立持久事实；四态优先级见 [Verdict architecture](../verdict/architecture.md)。

`evaluationKind` 只取 `pass | score`，是 Eval 定义的输入，不是 durable family。Pass Eval 的主要读数是 Verdict。
Score Eval 从同一份 sealed Assertions 中的 `points`、earned contribution 与 rubric 在读侧形成 earned score 及其完整度。低分和零分不会成为 failed；缺少必要 score material 时保留 partial 或 unavailable，而不伪造 `0`。完整规则见 [Score Eval](library/score-points.md)。

## 作者入口

作者仍在观察结果的位置登记 Assertion：

```ts
const turn = await t.send("搜索资料并说明结论。");

t.check(turn.message, includes("已完成"))
  .key("reply-complete")
  .label("说明已完成");

turn.succeeded().label("Turn 完成");
turn.calledTool("search").label("调用搜索工具");
  turn.judge.autoevals.closedQA("回答质量").gate(0.8);
```

`t.check` 只接收 `(value, match)`。scope 方法与 Judge recipe 已经登记同一种 Assertion；handle 只配置该 entry，不能登记第二条检查。

Score Eval 使用 `handle.score(points)` 或 `t.score(points)` 写明贡献。后者仍形成一个 Assertions entry，criterion 为内建 direct-score，而不是不透明的分数旁路。Score 不提供 gate 或 generic optional contribution；它保留 `.orStop()` 控制流 barrier 与 `t.skip(reason)`。

完整字段、封口、边界与读侧形成规则见 [Architecture](architecture.md)。

## 继续阅读

- [Library](library.md) —— 作者 API 和 handle 配置。
- [Value assertions](library/value-assertions.md) —— Match 与 refinement。
- [Scoped assertions](library/scoped-assertions.md) —— scope snapshot、`calledTool`、`notCalledTool` 与 `succeeded`。
- [Score Eval](library/score-points.md) —— points、rubric 与完整度。
- [Evidence](architecture/evidence.md) —— snapshot、refs 与完整度。
- [Source sites](architecture/source-sites.md) —— Assertions payload 内的源码位置与 Sources join。
- [Type reference](reference/README.md) —— 可编译的作者类型边界。
- [Record architecture](../record/architecture.md) —— 六个 fixed family、closure 与四态 Host。
- [Verdict architecture](../verdict/architecture.md) —— 每个 Attempt 的四态折叠。
- [Analysis Library](../analysis/library.md) —— `Sample`、`query()` 与 `DomainView`。
