# 完整示例

本页按任务索引完整例子。
API 的穷尽形状只在 [Library](../library.md) 定义，用例不复制第二份契约。

## 质量与成本

```tsx
export default defineReport(async (sample) => {
  const performance = await aggregate(sample, {
    by: { agent },
    values: { passRate, costUSD },
  });

  return (
    <Page title="Quality and cost">
      <Scatter
        points={performance}
        x="costUSD"
        y="passRate"
        point="agent"
      />
      <Table rows={performance} />
    </Page>
  );
});
```

同一份 EvidenceRow 数组同时交给图和表。

## 失败清单

```tsx
export default defineReport((sample) => {
  const failures = sample
    .scope({ evals: "security/" })
    .filter((attempt) =>
      attempt.result.verdict === "failed" ||
      attempt.result.verdict === "errored"
    );

  const attempts = failures.attempts
    .toSorted((a, b) =>
      (attemptCostUSD(b.result) ?? 0) -
      (attemptCostUSD(a.result) ?? 0)
    )
    .slice(0, 50);

  return <AttemptList attempts={attempts} />;
});
```

## 自定义读数

```ts
export const changedLines = rollup(
  async (attempt) => {
    const diff = await attempt.diff();
    return diff ? countChangedLines(diff) : null;
  },
  {
    withinEval: min,
    acrossEvals: mean,
    unit: "lines",
    better: "lower",
  },
);
```

把它放进 `aggregate(...).values`，与官方 Calculation 使用同一条路径。

## 报告旁复杂算法

成对差异、稳定性、固定题集成绩单与历史趋势各自声明公式和分母，最后通过 `metricValue()` 与 `evidenceRow()` 构造结果。
它们不注册成查询，不进入图表组件，也不扩张 Sample API。

完整叙事见：

- [固定题集成绩单](../use-case/分析/固定题集成绩单.md)
- [测量成对差异](../use-case/分析/测量成对差异.md)
- [诊断可靠性](../use-case/分析/诊断可靠性.md)
- [跟踪实验历史](../use-case/分析/跟踪实验历史.md)

## 多页与 React

- [构建多页报告](../use-case/构建报告/构建多页报告.md)
- [嵌入产品](../use-case/交付报告/嵌入产品.md)
- [接入外部业务数据](../use-case/构建报告/接入外部业务数据.md)

## 相关阅读

- [外壳与多页](shell.md)
- [排版原语与自定义 renderer](layout.md)
- [计算函数、分组与读数值](measures.md)
