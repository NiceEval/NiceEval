# PLAN-5（推荐）：普通值转换 + 静态 page

**相关文档**：[README](../README.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md) · [DECISION](../DECISION.md)

## 裁决形状

报告作者只使用普通函数、普通结果值和按显示形状命名的组件：

```text
静态 PageDefinition
  → Sample / AttemptEvidence
  → 普通 TypeScript 函数
  → 可序列化 Result
  → text / web 组件
```

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

## 正确性

`rollup()` 产生 Calculation，`aggregate()` 负责题内与跨题两级聚合。
 MetricValue 强制携带 value、samples、total、basis 与 refs。

无法表达为单 Attempt 标量的算法留在报告旁，但通过 `metricValue()` 与 `evidenceRow()` 交出可追溯结果。

## 复用

实体投影使用 `toAttemptRows()`、`toExperimentRows()` 等立即转换。
动态区块是普通函数；多页报告静态声明 pages。
 Attempt 详情是 `input: "attempt"` 的参数化 page。

只有新增显示形状时才定义双面 renderer。
 renderer 接已经计算好的普通值，不读取 Sample、Record 或 artifact。

## 取舍

这套形状比 PLAN-2 少三个公开运行协议，但保留 PLAN-2 追求的两级聚合、涵盖范围、证据与双面一致。
代价是 page render 成为粗粒度求值边界，跨 page 共享计算依赖内部透明缓存，而不是公开依赖图。

完整产品契约见 [Reports](../../../feature/reports/README.md)。
