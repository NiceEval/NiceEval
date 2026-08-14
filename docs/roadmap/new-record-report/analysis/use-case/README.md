# 按模型与条件比较多个运行

契约单源始终在 [Analysis Library](../library.md)。本页只展示字段如何搭配、查询怎样执行和结果怎样呈现，不重复定义公开类型。

目标是比较同一批 logical slot 在多个运行中的 pass rate 与 latency。每个运行保留自己的 model 和 condition，缺失成员仍留在原有分母中。

## 声明总体、维度和度量

领域包先声明逻辑 slot 总体，再发布按模型和条件分组的维度。它随后用受控 Attempt 输入声明两个度量。

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

passRate 的 ratio() 在 slot 层把 true 与 false 归成比例。latency 的 sum() 先归并同一 Attempt 的 timing 输入，再以最新完成的 Attempt 代表该 slot。

两个度量都把 expected logical slot 设为分母。某个 slot 缺少值时，其他 slot 的读数仍可形成部分结果，但分母不会因而减少。

## 对冻结查询句柄执行查询

Application Host 让 Analysis Host SDK 选择多个已完成运行，并把同一个 `AnalysisQuerySource` 传给领域包。该能力已经固定每个运行的预期 logical slot，并绑定当前 operation Scope，所以领域包不接收 root、Run ID 或文件路径。

```ts
import {
  query,
  type AnalysisQuerySource,
} from "niceeval/analysis";

export async function compareRuns(source: AnalysisQuerySource) {
  return query(source, {
    kind: "frame",
    population: logicalSlots,
    by: { model, condition },
    measures: { passRate, latency },
  });
}
```

这个调用是该路径唯一的查询入口。领域包不在同一任务中改用 analyze() 或 aggregate()。

## 多次运行如何对齐

假设冻结样本包含四个运行：两个 model 与两个 condition 的组合。每个组合都有 20 个预期 logical slot。

| model | condition | 预期 slot | pass rate | latency |
|---|---:|---:|---:|---:|
| atlas | without-memory | 20 | 19 / 20 | 20 / 20 |
| atlas | with-memory | 20 | 18 / 20 | 18 / 20 |
| nova | without-memory | 20 | 20 / 20 | 20 / 20 |
| nova | with-memory | 20 | 20 / 20 | 20 / 20 |

查询按 model 与 condition 形成四个稳定行。每行的 key 来自总体 identity 和完整分组坐标，显示排序或只显示前几行不会影响行身份。

atlas / with-memory 的 pass rate 可以有 value 0.89、state partial、observed 18 和 denominator 20。它与其它行仍按同一批预期 slot 比较，而不是按各自留下的可用值数量比较。

## 呈现 missing、partial 与 unsupported

调用方直接读取闭合读数，不把缺失成员替换成零，也不把不支持的输入伪装为正常结果。

```ts
const frame = await compareRuns(source);
const row = frame.rows.find(
  item =>
    item.dimensions.model === "atlas" &&
    item.dimensions.condition === "with-memory",
);

if (!row) {
  throw new Error("comparison row is absent");
}

const rate = row.measures.passRate;
const elapsed = row.measures.latency;

if (rate.state === "partial") {
  showCoverage(rate.observed, rate.denominator);
  showIssues(rate.issues);
  showEvidence(rate.refs);
}

if (
  elapsed.state === "unavailable" &&
  elapsed.issues.some(issue => issue.code === "unsupported")
) {
  showUnavailable("latency is unsupported for this host");
}
```

missing 成员使 partial 读数保留实际 observed 与完整 denominator。unsupported 是 issue 的明确原因；对应读数使用 unavailable 和 null value。

若所有成员都缺少但属于领域上的正常空集合，读数使用 empty。若 producer 或归并步骤失败，读数使用 failed，并保留相关 issues 与 refs。

Report 只消费 frame 中的闭合行。它可以按读数排序、限制显示并链接证据，但不能以显示后的行重新计算 pass rate 或 latency。
