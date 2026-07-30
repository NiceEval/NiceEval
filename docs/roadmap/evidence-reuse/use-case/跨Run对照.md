# 跨 Run 对照

## 场景

Experiment 对账回答「这条历史 Evidence 能不能满足当前要求」。
报告拼接多个 Run 回答的是另一件事：这些证据是否适合放进同一个统计样本。

两个问题共享 Agent、flags、Sandbox 与资源版本等落盘事实，但 timeout、budget、sandboxReuse 等字段在两边的代价不同，不能只比较一个 `configHash`。

## 怎么写

报告作者选择版本化 `ComparisonProfile`：

```typescript
const profile = comparisonProfile({
  version: 2,
  blockingDimensions: [
    "agent",
    "model",
    "flags",
    "sandbox",
    "resources",
    "sandboxReuse",
  ],
  annotations: ["timeoutMs", "budget"],
  ignored: ["attempts", "earlyExit", "maxConcurrency", "labels"],
});
```

读取面从每个 Run 落盘的 `ExecutionManifest` 投影这些维度：

- blocking 不同：不拼接；
- annotation 不同：允许拼接，但产生覆盖注记；
- ignored 不参与判断。

`requirementKey` 与旧 `configHash` 都只是索引或审计快照，不作为唯一可比性判据。

## 边界

新增 blocking 维度时，旧 Run 可能没有对应事实。
读取面不能用「今天的默认值」无条件填充昨天的数据：

- 能证明旧版本缺失等价于一个默认值时，由 profile 的迁移规则补值；
- 不能证明时记为 `unknown`，不自动与新 Run 拼接，并说明缺哪个字段。

因此读取期结构投影能避免哈希算法变化切断历史，但不能恢复从未落盘的事实。

`timeoutMs` 与 `budget` 属于 annotation：它们不改变已完成 Evidence 的判定含义，但会改变超时与覆盖缺口分布。
`sandboxReuse` 属于 blocking：题间状态边界不同的两批证据不可直接拼接。
