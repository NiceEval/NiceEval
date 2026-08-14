# ④ 呈现模型层

```text
┌────────────────────────────────────┐
│ Presentation Model = 闭合结果包   │
└────────────────────────────────────┘
```

## 心智模型

呈现模型回答“组件需要拿到什么完整数据”。它把 Analysis 输出整理为组件可消费的闭合值，同时保留分母、问题、身份和 Evidence 复核路径。

闭合表示组件与 renderer 不再查询 Record，不再执行 Analysis，也不再按需读取未知内容。所有必要数据或有界引用都已经确定。

## 两种呈现模型

```text
Analysis
   ├─ aggregate result ─→ SemanticFrame ─→ 中立组件
   └─ domain projection → DomainView ────→ 官方领域组件
```

两种模型共享 frozen Sample identity、problem model 与 Evidence identity。它们不要求所有领域对象都变成关系表。

## SemanticFrame

`SemanticFrame` 的心智模型是“带统计口径与复核路径的数据表”。

```ts
interface SemanticFrame<Fields extends FrameFields = FrameFields> {
  readonly sample: FrozenSampleIdentity;
  readonly population: PopulationIdentity;
  readonly fields: Fields;
  readonly rows: readonly SemanticRow<Fields>[];
  readonly problems: readonly AnalysisIssue[];
}
```

每一行包含完整 grouping coordinate 和稳定 opaque row key：

```ts
interface SemanticRow<Fields extends FrameFields> {
  readonly key: SemanticRowKey;
  readonly dimensions: DimensionValues<Fields>;
  readonly measures: MeasureValues<Fields>;
}
```

每一个 Measure cell 是完整结果：

```ts
interface MetricValue<Value> {
  readonly value: Value | null;
  readonly state: "available" | "partial" | "empty" | "unavailable" | "failed";
  readonly observed: number;
  readonly denominator: number;
  readonly issues: readonly AnalysisIssue[];
  readonly refs: readonly EvidenceRef[];
  readonly unit?: string;
  readonly format?: MeasureFormat;
  readonly better?: "higher" | "lower" | "neutral";
  readonly producerCompatibility: ProducerCompatibility;
}
```

中立组件通过 typed field identity 选择字段，不能接收需要作者维持长度一致的平行数组。

## Closed DomainView

`DomainView` 的心智模型是“为一个诊断任务准备好的案件卷宗”。它保留领域结构，不为了通用图表而压平。

```ts
type DomainView =
  | TraceView
  | AttemptTimelineView
  | EvidenceView;
```

Trace 保留树和时序：

```ts
interface TraceView {
  readonly type: "trace";
  readonly identity: TraceIdentity;
  readonly root: TraceSpanView;
  readonly problems: readonly TraceProblem[];
  readonly refs: readonly EvidenceRef[];
}
```

Attempt timeline 保留事件顺序与完成状态：

```ts
interface AttemptTimelineView {
  readonly type: "attempt-timeline";
  readonly identity: AttemptIdentity;
  readonly events: readonly TimelineEventView[];
  readonly completion: AttemptCompletionView;
  readonly problems: readonly AttemptProblem[];
  readonly refs: readonly EvidenceRef[];
}
```

已完成 Experiment 的 expected population、completed、failed 与 missing 是 Analysis 结果。它们进入 `SemanticFrame`，再由第 ⑥ 层官方 Experiment Report 组合 Table、Chart 与诊断组件。Experiment 不因拥有官方页面而成为 `DomainView`。

## 领域投影 API

领域投影属于平台与官方领域 package：

```ts
interface DomainProjection<Target, View extends DomainView> {
  readonly id: DomainProjectionIdentity;
  resolve(
    sample: FrozenSample,
    target: Target,
  ): Promise<View>;
}
```

Report 作者通常不直接调用领域投影。作者把 opaque identity 或 exact ref 交给官方组件，Report host 在语义树闭合前完成 projection。

## 禁止跨出的边界

- `SemanticFrame` 不暴露 Record object、文件路径或执行 capability。
- `DomainView` 不携带 lazy callback、Promise 或 live handle。
- renderer 不依据 `refs` 重新运行 Analysis。
- Trace、Attempt 和 Evidence 不因通用组件存在而强制压平成 rows。
- 已完成 Experiment 不增加专用 presentation model；它复用 `SemanticFrame` 与已有诊断 `DomainView`。
- presentation model 不保存为新的权威 Record schema。
