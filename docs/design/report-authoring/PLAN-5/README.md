# PLAN-5（历史）：普通值转换 + 静态 page

**相关文档**：[README](../README.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md) · [DECISION](../DECISION.md)

> 后续裁决改采 [PLAN-6](../PLAN-6/README.md)。本篇保留当时为何选择 closed input／static Page 的历史推导；
> 目标 Report 作者面采用 [PLAN-7](../PLAN-7/README.md)，不公开 `reportInputs()`、`defineCalculation()` 与 branded constructor。

## 裁决形状

报告作者只使用普通函数、普通结果值和按显示形状命名的组件：

```text
静态 Report
  → reportInputs 声明有限 projections
  → defineCalculation 调用普通 TypeScript 函数
  → ordinary closed value / ReportCalculationResult
  → Page 的 closed semantic tree
```

```ts
import { Result } from "effect";

const inputs = reportInputs({
  verdicts: attemptSlotProjection(verdictProjector),
});

const quality = defineCalculation({
  id: Result.getOrThrow(reportComponentId("quality")),
  inputs,
  completeness: "allow-partial",
  calculate: ({ sample, inputs }) =>
    deriveQuality(sample, inputs.verdicts),
});

const overview = definePage({
  id: Result.getOrThrow(reportComponentId("overview")),
  route: Result.getOrThrow(reportRoute("/")),
  calculations: { quality },
  render: ({ calculations }) => renderQuality(calculations.quality),
});

export default defineReport({
  id: Result.getOrThrow(reportId("quality")),
  calculations: { quality },
  pages: [overview],
});
```

## 正确性

Calculation 的公式使用普通函数，返回值没有 JSON 或 codec 约束。声称某个值具有完整度或统计口径时，作者定义具名
结果类型，并显式携带 observed、denominator、state、issues 与 refs；Page 不从 transport coverage 猜这些字段。

## 复用

实体投影由 `reportInputs()` 在 author callback 前闭合。可复用转换是普通函数；多页报告静态声明 pages。
Attempt 详情使用 PageFamily 从已经形成的 projected / calculated values 展开。

Page 返回 closed semantic tree。只有产品新增一种 `ReportBlock` variant 时才扩展 renderer；terminal、web 与 static 必须
同时支持。renderer 接已经形成的 tree，不读取 Sample、Record 或 artifact。

## 取舍

这套形状比 PLAN-2 少三个公开运行协议，但保留 PLAN-2 追求的涵盖范围、证据与双面一致。
代价是 Calculation 之间没有公开依赖图；需要共享的多阶段算法必须收进一个纯函数或一个 Calculation。相同 projection
declaration 的物理读取可由 host 去重，但次数与 cache hit 不成为作者语义。

完整产品契约见 [Inspection](../../../feature/inspection/README.md) 与 [Insight](../../../feature/insight/README.md)。
