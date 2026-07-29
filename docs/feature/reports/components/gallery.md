# 组件 Gallery

Gallery 用已经计算好的 fixture 验收每个显示形状。
fixture 是普通 JSON 值，不打开 Record，也不运行 Eval。

## 聚合行

```tsx
const points = await aggregate(sample, {
  by: { agent },
  values: { passRate, costUSD },
});

<Scatter
  points={points}
  x="costUSD"
  y="passRate"
  point="agent"
/>

<Table rows={points} />
```

## Attempt 证据

```tsx
const [turns, nodes, files] = await Promise.all([
  toConversationTurns(attempt),
  toTimelineNodes(attempt),
  toDiffFiles(attempt),
]);

<Conversation turns={turns} />
<Waterfall nodes={nodes} />
<DiffView files={files} />
```

## 验收

每个 fixture 同时验证 text 与 web：

- 字段终值、顺序、缺数据和 refs 一致；
- web 交互关闭后初始 HTML 仍完整可读；
- text 空间不足时使用声明过的降级，不静默丢字段；
- locale 切换只重新格式化，不重新计算 fixture。

完整组件入口见 [组件目录](README.md)。
