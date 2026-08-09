# 组件 Gallery

Gallery 用已经生成的 fixture 验收每个显示形状。
fixture 是冻结的 ReportData 片段，不打开 Record、不运行 Calculation，也不执行 page plan。

## 聚合行

```tsx
<Scatter points={performance} x="costUSD" y="passRate" point="agent" />
<Table rows={performance} />
```

`performance` 是完整 `AggregateData` fixture。available 分支的 `value` 包含 rows 与顶层 coverage，
每个 AggregateRow 再包含 MetricValue、basedOn 与 refs；外层还保留 basedOn 与 verification。
Gallery 也必须有 unavailable fixture，证明图和表不会把它换成 `null` 或空数组。

## Attempt 证据

```tsx
<Conversation turns={attempt.conversation} />
<Waterfall nodes={attempt.timing} />
<DiffView files={attempt.diff} />
```

每个属性都是已计划的 EvidenceValue 或其可用投影。
Gallery 不以展开、点击或 locale 切换触发新的读取。

## 验收

每个 fixture 同时验证 text 与 web：

- available / unavailable 判别、coverage 与 refs 一致；available 的 verification / issues 和 unavailable 的 causes / basedOn 都不丢失；
- web 交互关闭后，初始 HTML 仍完整可读；
- text 空间不足时使用声明过的降级，不静默丢字段；
- locale 切换只格式化，不能改变 ReportData。

完整组件入口见 [组件目录](README.md)。
