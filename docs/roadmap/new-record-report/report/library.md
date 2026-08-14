# Report Library（报告库）

本页是 Report 公共 API、Page failure（页面失败）和 `ClosedReportTree`（闭合报告树）的唯一契约。`query()` 的查询定义、参数与返回类型由 `niceeval/analysis` 拥有；本页只规定 Report 怎样调用它并消费闭合结果。

## 导入面

Report 作者从两个已有边界导入。组件、页面和报告定义全部来自 `niceeval/report`，唯一的数据查询函数来自 `niceeval/analysis`。

```ts
import {
  query,
  type AnalysisQuerySource,
  type AnalysisSampleSummary,
} from "niceeval/analysis";
import {
  Bars,
  defineComponent,
  definePage,
  definePageFamily,
  defineReport,
  EvidenceDrilldown,
  Scatter,
  Summary,
  Table,
  TraceViewer,
} from "niceeval/report";
```

| 入口 | 面向对象 | 提供 | 不提供 |
| --- | --- | --- | --- |
| `niceeval/analysis` | Analysis 与 Report 作者 | `AnalysisQuerySource`、`AnalysisSampleSummary`、`query()`、类型化 query 定义、`SemanticFrame`、`DomainView` | Record reader、SQL、executor 选择权 |
| `niceeval/report` | Report 作者 | `ReportContext`、组件、Page、Report 与闭合树类型 | 原始事实、projection、migration、renderer plugin |

Report 不导出第二个查询或聚合函数。所有数据请求都通过 `query(source, definition)` 进入 Analysis。

## 一份 Analysis 结果怎样展示

Report 只接收 ② Analysis 的两种闭合值：

| Analysis 输出 | 交给什么组件 | 例子 |
|---|---|---|
| `SemanticFrame`（语义数据帧） | `Summary`、`Table`、`Bars`、`Line`、`Scatter`、`Heatmap` | 按 model / condition 展示 pass rate、latency 与分母 |
| `DomainView`（领域视图） | `TraceViewer`、`AttemptTimeline`、`EvidenceDrilldown` | 展示某个 Attempt 的 span 树、事件时序或证据详情 |

Page callback（页面回调）用 `source` 调 Analysis query，再把闭合结果传给组件：

```tsx
const comparison = definePage({
  id: "comparison",
  route: "/comparison",
  title: "Experiment comparison",
  render: async ({ source }) => {
    const frame = await query(source, comparisonQuery);

    return (
      <Stack>
        <Bars frame={frame} x={model} y={passRate} />
        <Table frame={frame} columns={[model, condition, passRate]} />
      </Stack>
    );
  },
});

const experimentReport = defineReport({
  id: "experiment",
  pages: [comparison],
});
```

Report Host SDK 执行页面并选择呈现面：

```ts
const execution = yield* report.execute({
  source,
  sample,
  report: experimentReport,
  pages: "all",
});

yield* report.show(execution);                         // terminal
yield* report.serve(execution);                        // Web
yield* report.export({ execution, directory: outDir }); // static site
```

renderer（渲染器）只读 `ClosedReportTree`。它不会重新调用 `query()`、缩小分母或把 `partial` 改成正常零值。

## ReportContext

`ReportContext`（报告上下文）把唯一查询句柄与可显示摘要明确分开。

```ts
interface ReportContext {
  readonly source: AnalysisQuerySource;
  readonly sample: AnalysisSampleSummary;
}
```

`source` 只能在本次 Report execution（报告执行）的 Scope（资源作用域）内传给 `query()`；`sample` 只说明被冻结的选择、总体命中范围和整体问题，不能传给 `query()`。Report 作者不能自行构造 source，也不能从 sample 枚举 Run、Attempt、Event、Attachment 或事实路径。

调用 `query()` 后，Report 只得到 `SemanticFrame`（语义数据帧）或 `DomainView`（领域视图）。成功返回的对象已经包含该查询所需的值、身份、问题和证据引用；组件不能把它们送回 Analysis 形成新的统计口径。

```ts
import { query } from "niceeval/analysis";
import { experimentComparisonQuery } from "./experiment-analysis.js";

const frame = await query(source, experimentComparisonQuery);
```

每一次调用都绑定传入的同一 `source`。一个 Page 可以按已闭合的结果决定布局，并继续调用 `query()`；它不能替换 source、打开另一份 Record 或建立任意 join（连接）。

## 复合组件

`defineComponent()` 声明可嵌入其他 Page 或组件的 Report 组合。它返回声明值，不执行查询。

```ts
declare function defineComponent<Props>(
  render: (
    props: Props,
    context: ReportContext,
  ) => ReportNode | Promise<ReportNode>,
): ReportComponent<Props>;
```

`ReportNode` 由内建 semantic component（语义组件）或其他 `ReportComponent` 组成。callback 可以调用 `query()`，但返回前必须把结果交给组件；`AnalysisQuerySource`、Promise、callback 和 executor 不会进入 `ReportNode`。

```tsx
import { query } from "niceeval/analysis";
import { experimentComparisonQuery, model, passRate } from "./experiment-analysis.js";
import { Bars, defineComponent } from "niceeval/report";

export const ModelComparison = defineComponent(async (_props, { source }) => {
  const frame = await query(source, experimentComparisonQuery);

  return <Bars frame={frame} x={model} y={passRate} />;
});
```

一个 component instance 在一次 Report execution 中最多运行一次。普通 Report package 只能组合已有组件，不能注册新的 visual primitive 或 renderer。

## 中立组件

中立组件只接收 `SemanticFrame`。它们使用字段身份选择维度和度量，不接收需要调用者维持相同长度的平行数组。

| 组件 | 主要输入 | 呈现职责 |
| --- | --- | --- |
| `Summary` | frame、少量 Measure | 少量具名度量的摘要 |
| `Table` | frame、columns、sort、limit | 精确值、分母、状态、问题与 refs |
| `Bars` | frame、x、y、color、sort | 分类值比较 |
| `Line` | frame、x、y、color | 有序 Dimension 上的序列 |
| `Scatter` | frame、x、y、color | 两个 Measure 的关系 |
| `Heatmap` | frame、x、y、value | 两个分类维度的交叉比较 |
| `Callout` | tone、title、content | 具名限制或问题说明 |
| `Stack` / `Grid` | children | 布局，不改变数据语义 |

```tsx
<Summary frame={frame} fields={[passRate, duration]} />

<Table
  frame={frame}
  columns={[model, condition, passRate, duration]}
  sort={{ field: passRate, direction: "desc" }}
/>

<Scatter frame={frame} x={duration} y={passRate} color={model} />
```

每个 Measure cell 是完整的 `MeasureResult`（度量结果）。组件使用其 `state`、`observed`、`denominator`、`issues`、`refs`、`unit`、`format` 与 `better`；作者不手动补百分比、单位或分母。

## 领域组件

领域组件只接收已经闭合的 `DomainView`。它们不接受 Record target、投影 capability 或惰性查询对象。

| 组件 | 接收的 view | 呈现职责 |
| --- | --- | --- |
| `TraceViewer` | `TraceView` | span 树、追踪问题和 Evidence refs |
| `AttemptTimeline` | `AttemptTimelineView` | 时序事件、完成状态和对应证据 |
| `EvidenceDrilldown` | `EvidenceView` | 有界证据内容、媒体类型、截断状态和详情导航 |

```tsx
<TraceViewer view={trace} />
<AttemptTimeline view={timeline} />
<EvidenceDrilldown view={evidence} />
```

Analysis 在 `DomainView` 形成时完成身份查找与有界 Evidence 读取。Report 只决定这些 view 出现在哪个 Page；terminal、Web 和 static renderer 都读取同一份闭合 view。

## Page 与 Report

`definePage()` 声明一个固定 route 的阅读任务。route 参数是只读字符串，不能用来读取事实或改变 sample。

```ts
interface PageDefinition<Params extends object = {}> {
  readonly id: string;
  readonly route: string;
  readonly title: LocalizedText;
  readonly render: (context: ReportContext & {
    readonly params: Readonly<Params>;
  }) => ReportNode | Promise<ReportNode>;
}

declare function definePage<Params extends object = {}>(
  definition: PageDefinition<Params>,
): PageDefinition<Params>;
```

`definePageFamily()` 从闭合查询结果展开同类 Page。`instances` 可以调用 `query()`，但每个 instance 的 key 与 route 必须来自 Analysis 发布的稳定身份，不能依赖数组位置、显示 label 或近似时间。

```ts
interface PageFamilyDefinition<Instance> {
  readonly id: string;
  readonly instances: (
    context: ReportContext,
  ) => Iterable<Instance> | Promise<Iterable<Instance>>;
  readonly key: (instance: Instance) => PageInstanceKey;
  readonly route: (instance: Instance) => string;
  readonly title: (instance: Instance) => LocalizedText;
  readonly render: (context: ReportContext & {
    readonly instance: Instance;
  }) => ReportNode | Promise<ReportNode>;
}

declare function definePageFamily<Instance>(
  definition: PageFamilyDefinition<Instance>,
): PageFamilyDefinition<Instance>;
```

`defineReport()` 把固定 Page 与 PageFamily 收成唯一报告定义。

```ts
interface ReportDefinition {
  readonly id: string;
  readonly pages: readonly (PageDefinition | PageFamilyDefinition<unknown>)[];
}

declare function defineReport(
  definition: ReportDefinition,
): ReportDefinition;
```

Page、family 与 component callback 都在一次 Report execution 中最多运行一次。只请求某个 route 时，host 只执行该 Page 所需的 query；静态导出在一次 execution 中枚举目标 Page，并共享相同 source 的精确查询结果。

## Page failure

`report-page-failed` 表示一个 Page、family instance、其 query 调用或其组件 callback 无法形成语义节点。它不把 Analysis 的 `partial`、`empty`、`unavailable` 或 `failed` 度量状态伪装成页面缺失。

```ts
interface PageFailure {
  readonly code: "report-page-failed";
  readonly page: PageIdentity;
  readonly route?: ClosedRoute;
  readonly stage: "instances" | "query" | "component" | "render";
  readonly problem: ReportProblemIdentity;
}

type ClosedPage =
  | {
      readonly state: "closed";
      readonly page: PageIdentity;
      readonly route: ClosedRoute;
      readonly title: LocalizedText;
      readonly node: ClosedReportNode;
      readonly problems: readonly ReportProblemIdentity[];
    }
  | {
      readonly state: "failed";
      readonly page: PageIdentity;
      readonly failure: PageFailure;
    };
```

失败对象包含 Page identity、失败阶段与问题身份。失败只隔离该 Page 或该 family instance；其他 route 继续执行并进入闭合树。

## ClosedReportTree

`ClosedReportTree` 是 Report execution 的闭合结果，也是本层三个 renderer 的唯一输入。

```ts
interface ClosedReportTree {
  readonly report: ReportIdentity;
  readonly sample: AnalysisSampleIdentity;
  readonly pages: readonly ClosedPage[];
  readonly routes: readonly ClosedRoute[];
  readonly problems: readonly ReportProblem[];
  readonly provenance: ReportProvenance;
}
```

树只含闭合的 frame、view、组件节点、route 和问题。它不含 `AnalysisQuerySource`、Record reader、QueryPlan、Analysis executor、Promise 或 callback。相同的 `ClosedReportTree` 可以交给 terminal、Web 和 static renderer，而 renderer 不执行新的 query。

## Report Host SDK

Application Host 从 `niceeval/report/host` 取得 `ReportHostSDK`。它接收 ② Analysis 已签发的查询能力，不接收 Record snapshot：

```ts
interface ReportHostSDK {
  execute(input: {
    readonly source: AnalysisQuerySource;
    readonly sample: AnalysisSampleSummary;
    readonly report: ReportDefinition;
    readonly pages: "requested" | "all";
  }): Effect.Effect<ReportExecution, ReportExecutionError, Scope.Scope>;

  show(execution: ReportExecution): Effect.Effect<
    ReportShowOutput,
    ReportRenderError
  >;

  serve(execution: ReportExecution): Effect.Effect<
    ReportViewSession,
    ReportServeError,
    Scope.Scope
  >;

  export(input: {
    readonly execution: ReportExecution;
    readonly directory: OutputDirectory;
  }): Effect.Effect<ReportExportReceipt, ReportExportError>;
}

interface ReportExecution {
  readonly tree: ClosedReportTree;
}

interface ReportViewSession {
  readonly url: LoopbackUrl;
  publish(execution: ReportExecution): Effect.Effect<void, ReportServeError>;
}
```

`execute()` 在同一个 Scope（资源作用域）内把 `{ source, sample }` 交给 Page / component callback（页面 / 组件回调）并闭合结果。Scope 外只留下 `ReportExecution.tree`；它不返回 query capability、作者 callback 或 live reader（活动读取器）。

`show()` 形成终端输出。`serve()` 建立 Scope-bound（绑定资源作用域）的本机 Web session；后续 `publish()` 只接受另一份闭合 execution。`export()` 在 Record 与 Analysis Scope 关闭后写目标目录。三个方法都不能重新执行 query。
