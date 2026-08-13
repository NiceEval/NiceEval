# 官方 OTel Timing 从采集到 Report

这是 `niceeval.timing/v1` 的端到端 Use Case，不是通用 Library。definition、write grant、Projection 与 Report
的公共语法分别以 [RecordAttachment Library](../../record-attachment-authoring/library.md)、
[Record → Analysis → Report Library](../library.md) 和 [Reports Library](../../../feature/reports/library.md) 为单源；
本页只把这些语法代入官方 timing。

```text
in-process OTel span
  → verified Attempt owner clock bridge
  → sole owner-bound timing collector
  → niceeval.timing/v1 payload
  → generic RecordAttachment command
  → attempt-slot Projection
  → deriveObservedWindows()
  → Report Calculation / Page
```

OTel 是采集输入，不是持久事实权威。Record 中唯一的 timing 事实是 collector 封口后写入的
`niceeval.timing/v1`。raw OTLP、epoch timestamp、span attribute、provider 名称与 exporter provenance 都不落盘。

## 1. 官方 package 定义什么值

官方 package 在 package-private source 中调用同一个 `defineRecordAttachment()` compiler。它只多一枚不导出的
namespace authority；schema、plain-data、closure、owner、grant 与 migration 校验完全相同。

```ts
// package-private; definition 与 namespace authority 均不导出
const attemptTimingDefinition = defineRecordAttachment({
  namespaceAuthority: niceevalRecordAttachmentNamespace,
  owner: "attempt",
  name: "niceeval.timing",
  versions: {
    v1: {
      schema: attemptTimingAttachmentV1Schema,
      blobRefs: () => [] as const,
    },
  },
  current: "v1",
  migrations: () => ({}),
});
```

current producer 提交的是 v1 payload，不是整个 Record，也不是已经 materialize 的 `RecordAttachmentValue`：

```ts
const payload = {
  collection: { state: "complete", limitations: [] },
  intervals: [
    {
      intervalId: "interval_0123456789abcdefghjkmnpqrs",
      phase: "agent.send",
      label: "model-call",
      startOffsetMs: 120,
      durationMs: 840,
      parentIntervalId: null,
      outcome: "completed",
      refs: [],
    },
  ],
} satisfies AttemptTimingAttachmentV1;
```

只有 generic writer 发布成功、reader 在 frozen snapshot 中返回 `available` 后，consumer 才取得不可变的
`RecordAttachmentValue<AttemptTimingAttachmentV1>`。它包含 v1 payload 与自己的空 blob closure；它仍只是一份
Attempt-owned Attachment value。

公共包只导出只读 projector，不导出 writable definition、namespace authority 或 official write grant：

```ts
export const attemptTimingProjector = defineRecordAttachmentProjector({
  attachment: attemptTimingDefinition.reader,
  project: ({ payload }) => payload,
});
```

## 2. OTel span 怎样进入唯一 collector

Attempt coordinator 创建一枚 nominal owner-clock capability 和唯一 timing collector。OTel bridge 是该 collector 的
package-private adapter，不是另一个 writer，也不持有 `attemptTimingDefinition` 或 `ctx.recordEffect()`。

下面的 `captureOtelStart()` / `captureOtelEnd()` 表示 package 内 adapter seam，不是公共作者 API：

```ts
// SpanProcessor.onStart：在事件发生时用 Attempt 自己的 monotonic clock 采样。
collector.captureOtelStart({
  spanIdentity,
  owner: exactAttemptRef,
  clock: attemptClock,
  phase: "agent.send",
  label: "model-call",
  startOffsetMs: attemptClock.offsetNow(),
  refs: captureExactRefs(context),
});

// SpanProcessor.onEnd：仍用同一 owner-clock domain，而不是读取 span 的 epoch timestamp。
collector.captureOtelEnd({
  spanIdentity,
  owner: exactAttemptRef,
  clock: attemptClock,
  endOffsetMs: attemptClock.offsetNow(),
  outcome: "completed",
});
```

bridge 只接受同时满足以下条件的输入：

| 条件 | 为什么必须在 capture 时证明 |
|---|---|
| exact `RecordAttemptRef` 等于当前 collector owner | 防止 span 写进错误 Attempt |
| start 与 end 使用同一枚 verified owner-clock capability | offset 才能相减；Run 与 Attempt clock 不能拼接 |
| phase 与 label 来自稳定映射表 | raw span name、provider 与 attribute 不成为 durable schema |
| refs 在 capture 时已查找到同 owner 的 exact target | 不按文字、时间或数组顺序补猜引用 |
| span identity 尚未完成且 start/end 不冲突 | 一个 span 只形成一个 interval |

以下输入不形成 interval，并把 collection 标为 `partial`：

| 输入 | v1 limitation |
|---|---|
| 事后导入的 raw OTLP / epoch timestamp | `unsupported-input`，target 为 `timing-interval` |
| clock domain 不可证、owner 不匹配、phase / label 不稳定、ref 不精确 | `unsupported-input`，target 为 `timing-interval` |
| 重复 end、同一 span 的冲突 start/end 或重复 identity | `unsupported-input`，target 为 `timing-interval` |
| collector 本身失败 | `capture-failed`，stage 为 `timing-capture`，target 为 `timing-interval` |
| collector 被中断 | `capture-interrupted`，stage 为 `timing-capture`，target 为 `timing-interval` |

拒绝原因只进入既有 closed limitation，不把 raw span、异常文字或 provider metadata 写入 payload。已经验证的安全
interval 仍被保留，因此 partial 不等于 unavailable。

## 3. 封口并写入 Record

全部 Attempt finalizer 停稳后，唯一 collector 停止接收输入，检查 interval identity、checked safe-integer end、parent
containment 与 collection，然后形成一个 payload。built-in timing occurrence 对这个 owner 恰好提交一次 command：

```ts
const sealedTiming = yield* attemptTimingCollector.seal();

yield* ctx.recordEffect(
  attemptTimingDefinition,
  sealedTiming,
);
```

`ctx.recordEffect()` 只是不丢失 Effect error / defect / interruption 的内建 facade。它与第三方 `ctx.record()` 进入
同一个 admission、reservation、plain-data snapshot、closure validation、tracked command、poison 与 generic sink。

每个官方实际执行的 Attempt 都写 timing：

- 确知没有 interval 时写 `{ collection: complete, intervals: [] }`；这是 explicit empty，不是 duration 为零。
- 有安全 interval 但采集不完整时写 partial payload，并保留 limitation。
- 无法形成 exact safe payload、联合 contract 失败或 generic write 失败时，Run 不发布 complete marker。
- 只有历史 Record 或第三方 producer 从未写过该 family 时，读取才是 `unavailable`。

v1 是当前版本，暂时没有历史 edge，所以 migration graph 明确为 `() => ({})`。以后发布 v2 时必须在同一 definition
中增加相邻 edge；普通 write 与 read 不会提前或隐式迁移。

## 4. 普通 Analysis 怎样读取和计算

Analysis 先把 public projector 绑定到 Attempt slot access，再在同一 `AnalysisSampleHandle` 上执行 direct Projection：

```ts
// analysis/timing-analysis.ts
import type {
  AnalysisSlotRef,
  CoreInvalidAnalysisSlot,
  IncludedAnalysisSlot,
  NotRecordedAnalysisSlot,
  RecordAttemptRef,
} from "niceeval/analysis";
import {
  attemptSlotProjection,
  attemptTimingProjector,
  projectAnalysisSample,
  type AttemptTimingView,
  type ProjectedRecordAttachmentResult,
  type ProjectedSample,
} from "niceeval/projection";

export const timingByAttempt = attemptSlotProjection(
  attemptTimingProjector,
);

const projected = yield* projectAnalysisSample({
  sampleHandle,
  projection: timingByAttempt,
});

const windows = deriveObservedWindows(projected);
```

本用例把 `deriveObservedWindows()` 放在 application 的 `analysis/timing-analysis.ts`，普通 Analysis 与 Report 都
import 这一个纯函数。下面先固定该 module 的输入输出签名，函数体遵守随后七条规则。它不读 Record，也不依赖
Report。它返回应用自有的普通 closed value，而不是调用
`metricValue()`、`evidenceRow()` 或另一个 runtime：

```ts
type TimingIntervalId = AttemptTimingView["intervals"][number]["intervalId"];

interface TimingWindowRef {
  readonly slot: AnalysisSlotRef;
  readonly attempt: RecordAttemptRef;
  readonly intervalIds: readonly TimingIntervalId[];
}

type TimingWindowIssue =
  | {
      readonly code: "slot-not-recorded";
      readonly slot: NotRecordedAnalysisSlot;
    }
  | {
      readonly code: "core-invalid";
      readonly slot: CoreInvalidAnalysisSlot;
    }
  | {
      readonly code: "attachment-not-available";
      readonly slot: IncludedAnalysisSlot;
      readonly source: Exclude<
        ProjectedRecordAttachmentResult<AttemptTimingView>,
        { readonly state: "available" }
      >;
    }
  | {
      readonly code: "collection-partial";
      readonly slot: IncludedAnalysisSlot;
      readonly limitations: Extract<
        AttemptTimingView["collection"],
        { readonly state: "partial" }
      >["limitations"];
    };

interface TimingWindowRow {
  readonly slot: AnalysisSlotRef;
  readonly attempt: RecordAttemptRef | null;
  readonly state:
    | "excluded"
    | "not-recorded"
    | "core-invalid"
    | "unavailable"
    | "migration-required"
    | "migration-unavailable"
    | "unsupported"
    | "invalid"
    | "complete-empty"
    | "complete-observed"
    | "partial-empty"
    | "partial-observed";
  readonly observedWindowMs: number | null;
  readonly issues: readonly TimingWindowIssue[];
  readonly refs: readonly TimingWindowRef[];
}

interface ObservedTimingWindows {
  readonly rows: readonly TimingWindowRow[];
  readonly observed: number;
  readonly denominator: number;
  readonly state: "complete" | "partial";
  readonly issues: readonly TimingWindowIssue[];
  readonly refs: readonly TimingWindowRef[];
}

export declare const deriveObservedWindows: (
  projected: ProjectedSample<"attempt-slot", AttemptTimingView>,
) => ObservedTimingWindows;
```

规则是穷尽且固定的：

1. `rows` 与 `projected.sample.slots` 一一对应；excluded、not-recorded、core-invalid 与 Attachment 六态都不能消失。
2. `denominator` 直接等于 Analysis Sample 的逻辑 slot denominator；excluded row 保留但不进入该分母。
3. 对 available 且非空的 interval，先用 checked safe-integer addition 计算每个
   `end = startOffsetMs + durationMs`，再计算
   `observedWindowMs = max(end) - min(startOffsetMs)`。
4. complete-empty 是显式 empty，`observedWindowMs` 为 `null`，绝不改成 `0`。
5. partial 且非空仍保留 window、limitation 与 exact refs；partial-empty 保留 partial state，但没有数值。
6. `observed` 只数 `observedWindowMs` 非 `null` 的 slot；`refs` 对每个参与数值保留 slot、exact Attempt 与全部
   interval IDs。
7. 任一非 excluded 数据缺口使整体 state 为 partial；complete-empty 本身不制造问题。

这个 bounding window 不等于 interval duration 之和。v1 没有 designated root 或完整因果边，因而不能从这棵 parent tree
声称 Attempt 总耗时或 critical path，也不能跨 Attempt 自动求平均。

## 5. Report 怎样消费同一个纯函数

Report 只静态声明同一个 projection。Calculation 直接复用 `deriveObservedWindows()`；普通 Analysis 与 Report 不维护
两份公式。

```ts
import { Either } from "effect";
import {
  defineCalculation,
  definePage,
  defineReport,
  reportComponentId,
  reportDocument,
  reportId,
  reportInputs,
  reportMetric,
  reportRoute,
} from "niceeval/report";
import {
  deriveObservedWindows,
  timingByAttempt,
} from "../analysis/timing-analysis.js";

const inputs = reportInputs({ timing: timingByAttempt });

const observedWindows = defineCalculation({
  id: Either.getOrThrow(reportComponentId("observed-windows")),
  inputs,
  completeness: "allow-partial",
  calculate: ({ inputs }) =>
    deriveObservedWindows(inputs.timing),
});

const timingPage = definePage({
  id: Either.getOrThrow(reportComponentId("timing")),
  route: Either.getOrThrow(reportRoute("/timing")),
  calculations: { observedWindows },
  render: ({ calculations }) => {
    const result = calculations.observedWindows;

    if (result.state !== "available") {
      return reportDocument({
        title: "Timing",
        children: [{
          type: "status",
          tone: "negative",
          label: "Timing calculation unavailable",
        }],
      });
    }

    const value = result.value;
    return reportDocument({
      title: "Timing",
      children: [
        reportMetric({
          label: "Observed slots",
          value: `${value.observed}/${value.denominator}`,
        }),
        {
          type: "status",
          tone: value.state === "complete" ? "positive" : "warning",
          label: value.state,
        },
        {
          type: "table",
          caption: "Observed timing window by logical slot",
          columns: [
            { key: "slot", label: "Slot" },
            { key: "attempt", label: "Attempt" },
            { key: "state", label: "State" },
            { key: "windowMs", label: "Window (ms)", align: "end" },
            { key: "intervals", label: "Intervals" },
          ],
          rows: value.rows.map((row) => ({
            slot: `${row.slot.runId}/${row.slot.slotId}`,
            attempt: row.attempt?.attemptId ?? null,
            state: row.state,
            windowMs: row.observedWindowMs,
            intervals: row.refs.flatMap((ref) => ref.intervalIds).join(", "),
          })),
        },
      ],
    });
  },
});

export default defineReport({
  id: Either.getOrThrow(reportId("timing")),
  calculations: { observedWindows },
  pages: [timingPage],
});
```

Report host 仍会在内建 problems surface 保留 unavailable、migration、unsupported、invalid 与 callback defect。
页面能选择怎样显示 Calculation value，但不能把这些问题从 `ReportExecution` 删除，也不能在 render callback 中重新
打开 Record、导入 OTLP 或执行 migration。

## 完整路径的可核对断言

| 场景 | Record | Analysis | Report |
|---|---|---|---|
| verified OTel span | v1 interval | 有 observed window 与 exact refs | 显示数值行 |
| raw epoch / unknown clock | partial + `unsupported-input` | 保留 partial issue，不伪造 interval | warning 与 problems 可见 |
| 重复或冲突 span | partial + `unsupported-input` | 已验证 interval 保留 | 不把冲突计入 observed |
| complete-empty | available、intervals 为空 | `complete-empty`、数值为 `null` | 显示 empty，不显示 `0ms` |
| partial 且非空 | available partial | window 保留，整体 partial | 数值与 warning 同时可见 |
| 历史／第三方未写 | unavailable | 该 logical slot 仍在 rows 与 denominator | problems 提示缺失 |
| 已知未来旧版 | migration-required | 不运行 converter | problems 提示显式 `niceeval migrate` |

这条路径证明的中立性是：official timing 与第三方事实共享同一个机械 substrate；它不表示第三方可以取得
`niceeval.*` namespace、official definition 或 Attempt collector 的领域 authority。
