# Analysis 用例

契约单源始终在 [Analysis Library](../library.md)。本目录只说明怎样组合已定义的字段、执行查询
并把闭合结果交给 Report。

- [按模型与条件比较多个运行](#按模型与条件比较多个运行) —— 以固定分母比较 pass rate 与 latency。
- [选择与收窄一个分析范围](selection-and-narrowing.md) —— 显式历史选择、coverage、locator、codec 与 Scope。

## 按模型与条件比较多个运行

目标是比较相同 logical Slot 总体在多个 Run 中的 pass rate 与 latency。每个 Run 保留自己的
model 和 condition，缺失成员仍留在 Measure 的原有分母中。

领域包先声明总体、维度和两个 Measure。它不接收 Record root、RunId 或文件路径。

```ts
import {
  allLogicalSlots,
  attemptLatencyMs,
  attemptPassed,
  defineDimension,
  defineMeasure,
  definePopulation,
  latestCompletedAttempt,
  logicalSlotMembers,
  mean,
  oneValue,
  partial,
  query,
  ratio,
  retainContributingEvidence,
  sum,
} from "niceeval/analysis";

export const logicalSlots = definePopulation({
  id: "com.example.logical-slots",
  members: logicalSlotMembers,
});

export const model = defineDimension({
  id: "com.example.model",
  population: logicalSlots,
  value: slot => slot.model,
});

export const condition = defineDimension({
  id: "com.example.condition",
  population: logicalSlots,
  value: slot => slot.condition,
});

export const passRate = defineMeasure({
  id: "com.example.pass-rate",
  population: logicalSlots,
  input: attemptPassed,
  withinAttempt: oneValue<boolean>(),
  withinSlot: latestCompletedAttempt<boolean>(),
  acrossSlots: ratio(),
  denominator: allLogicalSlots(),
  missing: partial(),
  evidence: retainContributingEvidence(),
  unit: "ratio",
  format: "percent",
  better: "higher",
});

export const latency = defineMeasure({
  id: "com.example.latency-ms",
  population: logicalSlots,
  input: attemptLatencyMs,
  withinAttempt: sum(),
  withinSlot: latestCompletedAttempt<number>(),
  acrossSlots: mean(),
  denominator: allLogicalSlots(),
  missing: partial(),
  evidence: retainContributingEvidence(),
  unit: "ms",
  format: "duration",
  better: "lower",
});
```

普通 Report 调用只传入 Host 已签发的 Sample 和字段。`aggregate()` 只读取这两个 Measure 需要的
current 事实；它不会顺便读取 OTel trace、diff 或 blob。

```ts
import { aggregate, type Sample } from "niceeval/analysis";

export async function compareRuns(sample: Sample) {
  return aggregate(sample, {
    by: { model, condition },
    values: { passRate, latency },
  });
}
```

假设 Snapshot 有四组 Run，每组都有 20 个预期 logical Slot：

| model | condition | pass rate | latency |
|---|---|---:|---:|
| atlas | without-memory | 19 / 20 | 20 / 20 |
| atlas | with-memory | 18 / 20 | 18 / 20 |
| nova | without-memory | 20 / 20 | 20 / 20 |
| nova | with-memory | 20 / 20 | 20 / 20 |

`atlas / with-memory` 的 pass rate 保留 `value: 0.89`、`state: "partial"`、`samples: 18` 与
`total: 20`。latency 也保留自己的 18 / 20 实际贡献数；一个 Measure 的缺失不篡改另一个 Measure 的
分母。

```ts
const rows = await compareRuns(sample);
const row = rows.find(
  item => item.model === "atlas" && item.condition === "with-memory",
);

if (!row) throw new Error("comparison row is absent");

if (row.passRate.state === "partial") {
  showCoverage(row.passRate.samples, row.passRate.total);
  showIssues(row.passRate.issues);
  showEvidence(row.passRate.refs);
}
```

Report 可以 display-only 排序或限制 `rows`。它不能把 `row.passRate.value` 另算成一个新指标，
也不能因为页面只显示十行就把 `total` 改成十。

高级 Analysis 作者需要 frame identity 或 frame-level issues 时，使用同一 Measure 的 `query()`：

```ts
const frame = await query(sample, {
  kind: "frame",
  population: logicalSlots,
  by: { model, condition },
  measures: { passRate, latency },
});

renderFrame(frame.rows, frame.issues);
```

`frame.rows` 与上一个 `aggregate()` 返回的对应行使用同一统计口径。它们不是两套计算结果。
