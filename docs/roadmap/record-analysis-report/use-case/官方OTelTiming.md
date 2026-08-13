# 官方 OTel Timing

普通 Eval 作者只配置 tracing。Timing schema、Capture obligation、producer identity 与 Record 写入全部由 NiceEval 官方 package
拥有。

## Capture

```ts
import { defineEval, otelTiming } from "niceeval";

export default defineEval({
  tracing: otelTiming(),

  async test(t) {
    await t.send("完成任务");
  },
});
```

`otelTiming()` 在 Attempt 开始前固定官方 producer behavior，并在 Attempt Scope 中采集 OTel spans。普通作者不调用 `t.metric()`，
也不接触 span envelope。

官方 Capture 在内部完成：

```text
Attempt open
  → start official timing collector
  → receive OTel spans
  → normalize monotonic intervals
  → seal official Timing bundle
  → release exporter / collector
  → Attempt publication barrier
```

没有 span、exporter unavailable 与 collector failed 是不同 state。合法零毫秒值仍是 available，不按 falsy 值处理。

## Analysis

官方 `niceeval/analysis/timing` 发布：

```ts
import {
  duration,
  firstTokenLatency,
  timingPhase,
} from "niceeval/analysis/timing";
```

`duration` 与 `firstTokenLatency` 是 `Measure`，不是 raw span field。它们声明：

- logical-slot population；
- Attempt interval 到 slot value 的 reduction；
- denominator 与 missing policy；
- unit、format 与 lower-is-better；
- exact span / Attempt Evidence refs；
- OTel producer compatibility。

Analysis script 与 Report 使用同一 fields：

```ts
const rows = await analyze(sample, {
  by: { agent, phase: timingPhase },
  values: { duration, firstTokenLatency },
});
```

## Report

```tsx
export const TimingOverview = defineComponent(async (_props, { sample }) => {
  const rows = await aggregate(sample, {
    by: { agent },
    values: { passRate, duration, firstTokenLatency },
  });

  return (
    <Grid columns={2}>
      <Bars
        points={rows}
        x="agent"
        y="duration"
        sort={{ field: "duration", direction: "asc" }}
        layout="horizontal"
      />
      <Table rows={rows} />
    </Grid>
  );
});
```

`Bars` 从 `duration` Measure 取得毫秒格式与 lower-is-better。作者不手动读 `startTime` / `endTime`，不重复聚合，也不为 text 面
另写一张表。

## show slices

```console
niceeval show --timing @01K...
niceeval show --source @01K...
```

`--timing` 选择官方 Timing Page；它仍通过 Analysis fields 构建 closed semantic tree。`--source` 使用同一 frozen Sample 和
Evidence target，因此时间节点可以下钻到对应 source / operation，而不是开启第二个 raw reader。

## 四种异常

| 情况 | Capture | Analysis | Report |
|---|---|---|---|
| duration 为 0 | available | `MetricValue.value = 0` | 显示 `0 ms` |
| 没有生成 token span | empty 或 partial | denominator 保持，产生 issue | 显示缺失格与原因 |
| exporter 不可用 | unavailable | state 保留 | 显示 unavailable，不显示 0 |
| collector defect | failed | state 与 refs 保留 | Page problem 指向 producer identity |

官方身份不会绕过这些状态，也不会通过 private Report query 隐藏缺口。
