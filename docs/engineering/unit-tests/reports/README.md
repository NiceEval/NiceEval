# Reports 的测试架构

契约来源：[Reports](../../../feature/reports/README.md)、[Architecture](../../../feature/reports/architecture.md)、[Library](../../../feature/reports/library.md)、[Show](../../../feature/reports/show.md) 和 [View](../../../feature/reports/view.md)。Reports 必须先证明计算口径，再证明 text/web 两个面没有改写计算结果；视觉 snapshot 处于最后一层。用例登记在 [cases.md](cases.md)。

## 计算 fixture 要有区分力

通过率 fixture 应让几种常见错误算法得到不同答案：

```ts
const selection = reportSelectionFixture({
  experiments: [{
    id: "compare/codex",
    evals: [
      // 题 a：题内 2/3
      { id: "a", attempts: ["passed", "failed", "passed"] },
      // 题 b：题内 1
      { id: "b", attempts: ["passed"] },
      // skipped 不进入有效样本，但保留在 total
      { id: "c", attempts: ["skipped"] },
    ],
  }],
})
```

这个 fixture 中：

- 官方两级聚合是 `(2/3 + 1) / 2 = 5/6`。
- attempt 平铺是 `3/4`。
- 先把每题折成"任一轮通过"是 `2/2`。

三个值不同，测试才能发现错误复用了另一种口径。各题 attempt 数必须不同，否则两级聚合与平铺可能恰好相等。

## MetricCell fixture

所有指标组件共享三种不能混淆的值：

```ts
const cells = {
  measuredZero: {
    value: 0,
    display: "0",
    samples: 2,
    total: 2,
    refs: ["@1aaaaaaa", "@1bbbbbbb"],
  },
  partial: {
    value: 0.5,
    display: "50%",
    samples: 1,
    total: 2,
    refs: ["@1aaaaaaa"],
  },
  missing: {
    value: null,
    display: "no data",
    samples: 0,
    total: 2,
    refs: [],
  },
} satisfies Record<string, MetricCell>
```

每个组件至少验证 `null` 不被显示成 `0`、partial 保留覆盖率、refs 没有被渲染前计算丢掉。

## 测试次序：先 data，再双面，最后窄快照

1. **`.data()` 的事实**：数值、覆盖率、排序、缺失行为，全部数据级断言。
2. **text/web 双面同源**：两面显示同一份终值与 warning，不逐字比较。
3. **窄快照**：只锁短小、稳定、评审者能读懂的布局或完整错误反馈。

计算与格式化分别可断言（`value` 与 `display` 独立），不从渲染字符串反推计算正确。
