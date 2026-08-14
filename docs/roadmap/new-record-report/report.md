# ③ Report 层

```text
┌────────────────────────────────────┐
│ Report = 可执行报告配方            │
│ 用组件和页面让 Analysis 结果可理解 │
└────────────────────────────────────┘
```

## 心智模型

Report 回答“查询哪些结果，并怎样组织成完整查看工作流”。它在 frozen Sample 上执行一次 TypeScript 配方，使用中立组件、诊断组件、Page 和 route，最后只留下闭合语义树。

Report 内部包含组件词汇和页面组合，但它们共同服务于一个产品目标：让人找到、比较并复核 Analysis 结果。

```text
┌──────────────────────────────────────────────┐
│ Report                                      │
│                                             │
│ SemanticFrame ─→ Table / Bars / Scatter     │
│ DomainView ────→ Trace / Attempt / Evidence │
│                         ↓                   │
│              Page / PageFamily              │
│                         ↓                   │
│              Closed Report Tree             │
└──────────────────────────────────────────────┘
```

## 解决的问题

- 从 frozen Sample 调用 typed Analysis query。
- 组织 Summary、Table、Chart、Trace 与 Evidence。
- 建立 Page、PageFamily、route 与稳定下钻目标。
- 提供官方 Experiment Report。
- 隔离 Page failure。
- 为 terminal、Web 与 static 生成同一棵闭合语义树。

## ReportSample

Report 作者获得受限 `ReportSample`：

```ts
interface ReportSample {
  readonly identity: ReportSampleIdentity;
  readonly selection: ReportSelectionSummary;
  readonly problems: readonly ReportSampleProblem[];
  readonly coverage: ReportSampleCoverage;
}
```

它没有 `runs`、`attempts`、`events`、Record path、projection 或 migration capability。需要新总体、成员表或关系时，Analysis package 必须先发布 Population、Dimension、Measure 或 Relation。

## Query API

```ts
declare function aggregate<By extends Dimensions, Values extends Measures>(
  sample: ReportSample,
  options: {
    readonly by: By;
    readonly values: Values;
  },
): Promise<readonly AggregateRow<By, Values>[]>;
```

```ts
const rows = await aggregate(sample, {
  by: { model, condition },
  values: { passRate, latency },
});
```

每行包含完整 grouping coordinate、稳定 row key 和 `MetricValue`。callback 可以依据 closed rows 选择布局、显示顺序和后续组件，但不能从处理后的数组重新计算 Measure。

## 中立组件

中立组件只理解 Dimension、Measure、row、field metadata 与交互语义，不理解 Run、Attempt、Trace 或 evaluator。

```text
SemanticFrame
   ├─ Summary
   ├─ Table
   ├─ Bars
   ├─ Line
   ├─ Scatter
   └─ Heatmap
```

API 通过 typed field key 选择编码：

```tsx
<Table
  rows={rows}
  columns={[model, task, passRate, latency]}
/>

<Bars
  points={rows}
  x={model}
  y={passRate}
  color={condition}
  sort={{ field: passRate, direction: "desc" }}
/>

<Scatter
  points={rows}
  x={latency}
  y={passRate}
  color={model}
/>
```

中立组件必须显示或保留 `MetricValue` 的 state、observed、denominator、issues 与 refs。作者不能手动乘百分比、拼 unit 或把 partial 当作 available。

## 诊断组件

诊断组件理解树、时序、运行身份、评价过程和 Evidence navigation：

```text
opaque target / exact refs
   ├─ TraceViewer
   ├─ AttemptTimeline
   └─ EvidenceDrilldown
```

Report 作者 API：

```tsx
<TraceViewer trace={traceRef} />

<AttemptTimeline attempt={attemptRef} />

<EvidenceDrilldown refs={metric.refs} />
```

这些 props 只携带 opaque identity、exact refs 与显示选项。平台在 Report tree 闭合前按身份查找并形成对应 `DomainView`，renderer 不取得领域投影 capability。

## 自定义复合组件

Report package 可以定义复合组件：

```tsx
export const ModelLeaderboard = defineComponent(
  async (_props, { sample }) => {
    const rows = await aggregate(sample, {
      by: { model },
      values: { passRate, latency },
    });

    return <Bars points={rows} x={model} y={passRate} />;
  },
);
```

```ts
declare function defineComponent<Props>(
  render: (
    props: Props,
    context: { readonly sample: ReportSample },
  ) => ReportNode | Promise<ReportNode>,
): ReportComponent<Props>;
```

一个 component instance 在一次 `ReportExecution` 中最多执行一次。它只能返回内建 semantic primitives 或其它复合组件。

新增 host primitive 必须同时定义 terminal、Web、static 与无 JavaScript 降级语义。普通 Report package 不能注册 renderer plugin。

## Page API

```ts
interface PageDefinition {
  readonly id: string;
  readonly route: string;
  readonly title: LocalizedText;
  readonly render: (context: {
    readonly sample: ReportSample;
    readonly params: Readonly<Record<string, string>>;
  }) => ReportNode | Promise<ReportNode>;
}

declare function definePage(
  definition: PageDefinition,
): PageDefinition;
```

PageFamily 的 key 必须来自 Analysis 发布的 stable identity Dimension。route 不能使用数组 index、显示 label 或模糊时间匹配。

## Report API

```ts
interface ReportDefinition {
  readonly id: string;
  readonly pages: readonly (PageDefinition | PageFamilyDefinition)[];
}

declare function defineReport(
  definition: ReportDefinition,
): ReportDefinition;
```

```tsx
const overview = definePage({
  id: "overview",
  route: "/",
  title: "实验概览",

  render: async ({ sample }) => {
    const rows = await aggregate(sample, {
      by: { model },
      values: { passRate, latency },
    });

    return (
      <Stack>
        <Bars points={rows} x={model} y={passRate} />
        <Table rows={rows} columns={[model, passRate, latency]} />
      </Stack>
    );
  },
});

export default defineReport({
  id: "experiment-report",
  pages: [overview, attemptPageFamily],
});
```

## 官方 Experiment Report

已完成 Experiment 是官方查看与比较工作流。它使用普通 `defineReport()`、Page 和组件合同，不增加专用 Experiment primitive。

```text
Official Experiment Report
   ├─ Overview Page
   │    ├─ Summary
   │    ├─ Bars
   │    └─ Table
   ├─ Comparison Page
   │    ├─ Table
   │    └─ Scatter
   └─ Attempt PageFamily
        ├─ AttemptTimeline
        ├─ TraceViewer
        └─ EvidenceDrilldown
```

Overview 与 Comparison 的 expected population、对齐、missing、partial 和 unsupported 来自 Analysis `SemanticFrame`。Attempt PageFamily 只用 stable identity Dimension 建 route，并通过已有诊断组件完成复核。

没有配置自定义 Report 时，`niceeval show` 与 `niceeval view` 选择平台提供的官方 Experiment Report。自定义 Report 复用同一组 Analysis fields 和组件，不建立第二套实验比较口径。

运行中的 Experiment 若需要 pending、running、retrying 与 completed 状态机，应由独立 live execution 方向定义。该能力不能借已完成 Experiment 的 Report 名义进入组件协议。

## Closed Report Tree

Report execution 的唯一输出是闭合语义树：

```ts
interface ClosedReportTree {
  readonly report: ReportIdentity;
  readonly sample: ReportSampleIdentity;
  readonly pages: readonly ClosedPage[];
  readonly routes: readonly ClosedRoute[];
  readonly problems: readonly ReportProblem[];
  readonly provenance: ReportProvenance;
}
```

诊断组件的 opaque target 已经按身份查找并形成 closed `DomainView`。Evidence preview 已经按 exact refs 闭合为有界内容或明确问题。

## Execution 保证

1. 每个 Page 或 component instance 在一次 execution 中最多执行一次。
2. 每次 `aggregate()` 编译本次有限 field DAG，不预跑整个 Report。
3. 同一次 execution 按 Sample 与 exact field identity 缓存。
4. 只执行请求的 Page；一个 Page 失败不使其它 Page 失去执行能力。
5. static export 在一次 execution 中枚举目标 Pages，并共享 exact field cache。
6. execution 完成后，renderer 只能得到 `ClosedReportTree`。

## 禁止跨出的边界

- 不枚举 raw Run、Attempt、Event 或 Attachment。
- 不打开另一个 Record root，也不改变 frozen selection。
- 不写 SQL 查询 Record 物理表。
- 不重新聚合 rows，也不缩小 denominator。
- 不保存新的权威比较表或 Report schema。
- 不把完整 Experiment 工作流压成一个专用 component。
- 不允许 renderer 重新执行 callback、Query 或领域 projection。
