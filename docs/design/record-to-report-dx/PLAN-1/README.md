# PLAN-1：Consumer-local opaque query graph

Report 作者只声明页面需要哪些事实，再用普通同步 TypeScript 把已形成的值变成页面或下载。
作者不再手工串联 projector、Projection、`reportInputs` 与 Calculation，也不再对齐多份
`ProjectedSample`。

Record 的 portable format、Core、owner、Attachment schema、migration 与 frozen reader
仍是底层事实边界。本候选只重做 Record 之上的选择、查询、派生与 Report 作者面；它不要求修改
已保存的 Record bytes。

## 核心心智

普通作者只学习四个概念：

- `ReportQuery<Value>` 是不可由作者执行的静态取数声明；
- logical slot 是 `(selectedRunId, slotId)` 标识的一次样本位置；
- `derive()` 用普通同步函数从 query value 派生另一份 query value；
- Page、PageFamily 与 Download 在自己的 `data` 字段声明依赖。

`attemptSlots()` 按 logical slot 形成穷尽 rows。每个 query 用三个显式 relation 区块区分
selected Run、Attempt 与 origin Run。Run-owned field 没有默认 lineage。

```ts
const assessment = attemptSlots({
  selectedRun: {
    evaluation: evaluations,
  },
  attempt: {
    assertions,
    verdict,
    score: allowUnavailable(score),
  },
  originRun: {
    evaluation: evaluations,
  },
});
```

相同 query `const` 被多个 consumer 使用时只执行一次。两个结构相同、但分别创建的 query 不会
被宿主猜成同一个。组件只接收已经形成的普通值，不能读取 Record。

## 范围

本候选包含：

- `attemptSlots()` 与 selected Run rows 等有限 grain query；
- typed Attachment field 与唯一的自定义 `attachment(family, project)` 叶子；
- `allowUnavailable()`、穷尽 rows、coverage 与 logical evidence；
- consumer-local `data`、`derive()`、官方 metrics 和 query identity；
- Page、PageFamily、Download 的逐 consumer 失败隔离；
- 参数化 Attempt 页面通过同一 public query 作者面取得 Assertions、Verdict、Score 与 source；
- plain string ID、route 与 object key 的集中定义校验；
- 对现有 Record 模型的反向充分性审计。

本候选不包含 SQL、GraphQL endpoint、React hooks、公开 Source 协议、公开 Projection、
`reportInputs`、public Calculation registry、query 内 `where`、per-instance query 或组件 I/O。

官方 Report 与用户 Report 使用同一套 API。Built-in page 没有 `evidence(locator)`、private reader、
隐藏 Projection 或其它 host-only 取数能力；官方页面缺少字段时，必须先增加 public Attachment
field 或 query constructor。

Selection 仍在 Report 外固定 logical universe。查询不能删除缺失行；分类和聚合必须保留原始
denominator、reasons 与 evidence。

## 端到端路径

应用层显式打开 frozen Record、选择 Runs，再执行 Report：

```ts
const execution = yield* Effect.scoped(
  Effect.gen(function* () {
    const record = yield* openRecord({ root });
    const analysis = yield* selectRuns(record, explicitRuns({ runIds }));
    return yield* executeReport({ analysis, report });
  }),
);
```

`openRecord()` 返回 scope-bound frozen capability。`selectRuns()` 固定 selected Runs、logical slots
与 denominator。Report author 不持有这两个对象，只创建 opaque `ReportQuery`，并把 query 放进
consumer-local `data`。

这套候选把 Record open、selection、query、derive 与 consumers 保留为五个明确阶段。作者不实现
任何执行协议，但必须理解 query identity 与 consumer dependency。

## Cases

本候选的可核查状态见 [Evaluation](../EVALUATION.md)。C4b 由 query identity、consumer dependency
closure 与局部 problem 实现；C10 需要脚本学习 `runQuery({ analysis, query })`；C11 仍受当前完整
blob snapshot 限制。其它 Cases 尚未逐一展开，不以“可表达”替代验证。

## 入口

- [Library](library.md)：完整作者语法、query value 与官方 metric 形状。
- [Architecture](architecture.md)：执行闭包、隔离边界与 Record 充分性审计。
- [Attempt 详情](use-case/attempt-details.md)：Assertions、Verdict 与 Score 的完整调用路径。
