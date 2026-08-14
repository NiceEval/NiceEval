# Reports Library

本页以 `niceeval/report` 作为唯一公开作者入口。它导出 Report DSL、Theme 与官方 opaque
projector，也导出 projection declaration constructors 与需要的纯 Analysis / Projection 类型。
Record selection、reader-bound handle 与 projection interpreter 属于 CLI 的内部 Report host。
loader、watcher、文件系统、server 与 execution 调度也留在内部，不导出
`niceeval/report/host` 或 `niceeval/report/host/node`。

依赖方向固定为：

```text
internal Record
      ↓
internal selection
      ↓
internal projection runtime
      ↓
niceeval/report
      ↓
internal Report host
      ↓
CLI / Node runtime
```

Report 作者只理解两件事：需要哪些 `RecordProjection`，以及怎样把 projected values / derived values 包装成页面或下载。作者 callback 看不到 `RecordReader`、root、Scope、Effect、path、owner lookup、compiled plan 或 route expansion。

## Locale 与正文

```ts
type ReportLocale = "en" | "zh-CN";

type LocalizedText =
  | string
  | { readonly en: string; readonly "zh-CN": string };
```

作者用 `LocalizedText` 声明会随界面语言变化的标题、标签与说明。单个 string 在两个 locale 中
保持相同。host 在执行 Report 时选定一个 `ReportLocale`，并把所有 `LocalizedText` 转为该 locale 的
string。classic callback 会从只读 `Sample.locale` 得知本次闭合使用的 locale，但浏览器请求和语言按钮
不会直接调用 callback；host 会拒绝两种 locale 中发生 route、identity、数值、coverage 或状态分叉的结果。

因此每份 `ReportExecution` 只保存一个 locale 的正文。Sample、数值、coverage、问题、row identity、
route 与 entity target 不是两份 locale 数据；它们是同一份 execution 的非本地化业务载荷。browser host
在自己的 `ViewRevisionClosure` 中配对两个 locale execution，具体发布规则见 [Architecture](architecture.md#本地化-execution-与-view-revision)。

## Classic facade

`niceeval/report` 的公开作者面是 0.12 经典面。页面 `render(sample)` 可以直接组合内置组件；可复用业务组件使用 `defineComponent((props, ctx) => ...)`，并从 `ctx.scope` 取得当前 Sample。需要自定义投影或计算的作者继续使用下文低层 projection API。两条路径共享同一个 `ReportExecution`。

```ts
import type { Sample } from "niceeval/record";
import {
  Bars,
  Col,
  ExperimentScatter,
  ExperimentTable,
  Hero,
  SampleSummary,
  Section,
  aggregate,
  costUSD,
  defineComponent,
  defineReport,
  experiment,
  passRate,
} from "niceeval/report";
```

### defineReport classic overload

```ts
declare const defineReport: (definition: {
  readonly title: LocalizedText;
  readonly pages: readonly {
    readonly id: string;
    readonly title: LocalizedText;
    readonly render: (sample: Sample) => ClassicElement | Promise<ClassicElement>;
  }[];
}) => Report;
```

`render(sample)` 接收 host 一次投影后构造的深冻结 `Sample`，返回受控 JSX 树。`Sample` 类型从 `niceeval/record` 导入；它没有 reader、path 或 Record I/O。locale 在 host 创建 execution 时已经选定；`render` 不会因语言切换再次调用。

classic 的 page / Section 标题、Hero 的 title / description / link label 与 logo alt 都接受
`LocalizedText`。闭合 `ReportDocument` 保存已经选定 locale 的 string，不保留作者声明的两种文本。

已有 React 报告可以保留 `jsx: "react-jsx"`；NiceEval 会接收 React 产出的 element，但仍拒绝原生 DOM 与未包装组件。不想引入 React runtime 的报告可在自己的 `tsconfig.json` 使用 `jsx: "react-jsx"` 与 `jsxImportSource: "niceeval/report"`，改走包内受控 JSX runtime。两种写法形成同一棵 classic element tree。

```tsx
async function classicOverview(sample: Sample) {
  const rows = await aggregate(sample, {
    by: { experiment },
    values: { passRate, costUSD },
  });
  return (
    <Col>
      <Hero
        title="MemoryBench Classic"
        logo={{ src: logo, alt: "MemoryBench Classic" }}
        description="Hero, SampleSummary, leaderboard Bars, ExperimentScatter, and ExperimentTable."
        links={[{ label: "NiceEval", href: "https://github.com/NiceEval/NiceEval" }]}
      />
      <SampleSummary />
      <Section title={{ en: "Leaderboard", "zh-CN": "排行榜" }}>
        <Bars points={rows} x="experiment" y="passRate" layout="horizontal" />
      </Section>
      <ExperimentScatter input={sample} />
      <ExperimentTable input={sample} />
    </Col>
  );
}
```

可复用业务组件沿用 0.12 的 compose 形态。`ctx.scope` 是当前页面的深冻结 Sample，
因此组件可以聚合数据并继续返回受控组件树：

```tsx
const Leaderboard = defineComponent(async (_props, ctx) => {
  const rows = await aggregate(ctx.scope, {
    by: { experiment },
    values: { passRate },
  });
  return <Bars points={rows} x="experiment" y="passRate" layout="horizontal" />;
});

const overview = () => <Col><Leaderboard /></Col>;
```

### 受控 JSX 边界

组件树只接受内置组件与 `Fragment`；子节点可以是数组、string、number 或 null。它拒绝：

- 原生 tag（`div`、`span` 等）与任意 unbranded component；
- `head`、script、style、font、worker、WASM 与 raw HTML；
- 自定义 text / web 双面 renderer 与平行 `textAlternative`；
- reader-backed Sample、Record root、path 与 Effect 值。

trusted TS module 本身不是 sandbox；module 仍可以 import `node:fs` 或读 env。NiceEval 只保证 classic 组件拿不到 reader、Effect、Record root / path 与 append-I/O capability。

### 内置组件

| 组件 | 职责 |
| --- | --- |
| `Col` | 纵向布局容器，按声明顺序排列子块。 |
| `Section` | 带标题的块。 |
| `Hero` | 页首摘要块；`title`、`logo`、`description` 与 `links`。链接只接受绝对 https；logo 只接受绝对 https 或 `data:image`。host 只序列化，不 fetch。 |
| `SampleSummary` | 当前 Sample 概况：实验、Eval、attempt 与 coverage。 |
| `Bars` | 柱状图；`layout="horizontal"` 呈现横向柱状图，points 来自 `aggregate` 行。`color` 指向的具名 series 形成与柱体纹理、颜色一致的可访问图例。 |
| `ExperimentScatter` | 按 Experiment 的散点；`input={sample}` 传入同一份闭合 Sample。对应 experiment 页已展开时点可下钻，否则保持纯图形。 |
| `ExperimentTable` | 实验级读数表；`input={sample}` 传入同一份闭合 Sample。输出显式的 Experiment → group/eval → Attempt 父子拓扑与可选实体 target；终端缩进只是该拓扑的呈现结果。 |
| `Grid` / `Stat` / `Table` | 排版原语：格网、读数格、单元格表。 |
| `SampleNotices` / `CopyBlock` | 选择提示与可复制文本。 |
| `AttemptSummary` / `AttemptAssessment` | Attempt 详情页组合件。 |

`standardExperimentPage` 与 `standardAttemptPage` 是 PageFamily。它们分别按 Sample 里已有的 experiment id 与 attempt locator 展开固定 route。experiment 页的 render 收到按该 experiment 收窄后的闭合 Sample；attempt 页收到闭合 `AttemptEvidence`。它们不进入主导航。

`ExperimentScatter` 与 `ExperimentTable` 的 target 只在对应 route 已由当前 Report 展开时写出 href。单页 Report 不声明该 PageFamily 时，图表和层级仍正常呈现，但没有链接。static export、直接请求、新标签页与 live dialog 共用同一个 ordinary exact-route href。

### aggregate、passRate、costUSD 与 experiment

```ts
type AggregationSubject = {
  readonly experimentId: string;
  readonly evalId: string;
  readonly run: {
    readonly experiment?: {
      readonly labels?: Readonly<Record<string, string | number>>;
      readonly flags?: Readonly<Record<string, JsonValue>>;
    };
  };
};

type GroupFunction = (subject: AggregationSubject) => string;

declare const experiment: GroupFunction;

declare const aggregate: (
  sample: Sample,
  options: {
    readonly by: Readonly<Record<string, GroupFunction>>;
    readonly values: Readonly<Record<string, Calculation>>;
  },
) => Promise<readonly AggregateRow[]>;
```

`AggregationSubject` 携带 `experimentId`、`evalId` 与对应 run 的声明字段。`experiment` 按 `experimentId` 分组。`GroupFunction` 从这些字段取分组值；缺少的字段按 unknown 处理，不读当前项目声明。`aggregate` 的 `by` 在 Eval 级分组，不能把同一道题的 attempts 拆开。

`passRate` 是严格两级分母的官方 Calculation：

- 第一级：每个 (experiment, eval) 单元内，attempt 判定取均值，passed = 1、failed / errored = 0；
- skipped / missing 不进入分子，也不伪造值；coverage 显式显示缺口；
- 第二级：单元级值跨 Eval 等权平均，得到分组行与总值；
- 每行返回 observed / denominator / coverage，缺失不得改写成 0。

`costUSD` 用同一套两级分母聚合已投影成本；缺失成本保持 null，不补 0。

### 固定 projection plan 与同一执行路径

classic facade 先声明固定 projection plan：evaluation plan、verdict、kind-gated score、usage 与 timing。Score 对 Pass Eval 为 not-applicable，对 Score Eval 为 required；Evaluation kind 无法判定时保持 unresolved。host 只投影一次，构造深冻结 `Sample`，再经同一条 fixed-page callback 调用 `page.render(sample)`。

展开结果进入同一个 closed semantic validation，形成同一个 `ReportExecution`，show、view 与 static export 只消费它。`classic-dashboard` 只是 presentation profile；facade 不是第二套数据或渲染真相。

### selection-origin

`Sample` 的 metadata 携带 `metadataOrigin` 标注出处，不读取当前项目声明来填充历史数据：

- project-current：使用完整 current-declaration profile，并显示 `metadataOrigin: "current-declaration"`；
- explicit-runs（`--run`）：Record 没有 durable profile 时 metadata 是 unknown / partial，experiment id 回退为 id / unknown，并给出一条结构化 notice；
- 两种情况都不与当前项目字段混合。

本契约不新增 durable profile attachment，也不改 Record；future durable profile 属于边界，不是当前承诺。

## 低层 projection API 作者调用面

低层 projection API 继续存在，与 classic facade 共享同一个 `ReportExecution` 路径。它保留 `RecordProjection` 声明、Calculation 与 Page / PageFamily / Download，供需要自定义投影与计算的作者使用。

```ts
import { Effect, Either } from "effect";

const verdicts = attemptSlotProjection(verdictProjector);
const evaluations = selectedRunProjection(evaluationsProjector);
const passInputs = reportInputs({ verdicts, evaluations });

const passRate = defineCalculation({
  id: Either.getOrThrow(reportComponentId("pass-rate")),
  inputs: passInputs,
  completeness: "allow-partial",
  calculate: ({ sample, inputs }) =>
    calculatePassRate(sample, inputs.verdicts, inputs.evaluations),
});

const overview = definePage({
  id: Either.getOrThrow(reportComponentId("overview")),
  route: Either.getOrThrow(reportRoute("/")),
  calculations: { passRate },
  render: ({ calculations }) => {
    const result = calculations.passRate;
    return reportDocument({
      title: "Summary",
      children: [
        reportMetric({
          label: "Pass rate",
          value: result.state === "available" ? result.value.rate : null,
        }),
      ],
    });
  },
});

export default defineReport({
  id: Either.getOrThrow(reportId("summary")),
  calculations: { passRate },
  pages: [overview],
});
```

公开领域对象只叫 `Report`。`ReportDefinition` 不存在于 public API；`ReportPlan`、`ReportInput`、binding、matrix、prepare、materialize 与 route expansion receipt 都是 host 编译机械，不进入作者签名、教程或 Concepts。

## 数据计划

Report 直接复用 [Projection Library](../projection/library.md) 的声明与穷尽结果。`reportInputs` 把具名 projection 形状变成 `ReportDataPlan`，并让每个 key 精确推导出 `ProjectedSample<Access, Value>`：

```ts
type AnyRecordProjection = RecordProjection<any, any>;

declare const ReportDataPlanTypeId: unique symbol;

interface ReportDataPlan<
  out Shape extends Readonly<Record<string, AnyRecordProjection>> =
    Readonly<Record<string, AnyRecordProjection>>,
> {
  readonly [ReportDataPlanTypeId]: { readonly _Shape: () => Shape };
}

declare const reportInputs: <
  const Shape extends Readonly<Record<string, AnyRecordProjection>>,
>(shape: Shape) => ReportDataPlan<Shape>;

type ReportDataShape<Plan extends ReportDataPlan> =
  Plan extends ReportDataPlan<infer Shape> ? Shape : never;

type ReportProjectedValues<Plan extends ReportDataPlan> = {
  readonly [Key in keyof ReportDataShape<Plan>]:
    ReportDataShape<Plan>[Key] extends RecordProjection<infer Access, infer Value>
      ? ProjectedSample<Access, Value>
      : never;
};
```

`any` 只用于 package declaration 内部表达 existential `RecordProjection`；作者 callback 的每个 key 仍精确推导 `Access` 与 `Value`。普通 named interface 不需要 index signature、显式 generic 或 `as`。

`reportInputs` 是输入 key 的唯一 constructor。Key 满足 `[a-z][a-z0-9_-]*` 且 UTF-8 最多 64 bytes；constructor 拒绝 symbol、accessor、non-plain object 与非法 key。返回 plan 由 package-private WeakMap 持有 projection objects，不能靠复制 brand 伪造；host 从 canonical plan 生成 bounded numeric `ReportProjectionId`。

三个 factory 的基数分别是：

- `attemptSlotProjection(projector)`：对 `sample.slots` 每项一条；
- `attemptOriginRunProjection(projector)`：仍是每个 slot 一条，只把 included slot 的 owner 定位为该 Attempt 的 origin Run；
- `selectedRunProjection(projector)`：对 `sample.runs` 每项一条。

excluded、not-recorded 与 core-invalid 不会从 projected sample 消失。十个 slot 指向同一 origin Run 时仍有十条公开 logical entries；物理去重只属于 host telemetry。

每个 `RecordAttachmentProjector` 解释一个 owner 类型与一个 `RecordAttachmentFamily`。Projector callback 只在 Attachment `available` 时执行，同步消费完整 `RecordAttachmentValue` 并返回 view value，不能执行额外 Record I/O。callback throw 在 direct API 是 defect。Report host 在消费边界把它记为引用该 projection 的 consumer 的 execution problem，其它页面继续。

`ProjectedSample<Access, Value>` 只有两个 generic 参数：`sample`、`access`、`entries` 与 `coverage`。Attachment result 使用 `ProjectedRecordAttachmentResult<Value>` 的六态 union。

六态是 available、unavailable、migration-required、migration-unavailable、unsupported 与 invalid；available 保存 projector 从完整 Attachment 值返回的 view value。host 不引入第三个 failure generic、output codec 或 portable envelope。

`migration-required` 只表示存在相邻 converter 的完整迁移链，command 提示运行 `niceeval migrate`。`migration-unavailable` 表示旧 schema 的已知路径碰到 `not-losslessly-migratable`，明确没有无损 converter。因此它不提示再次运行 `niceeval migrate`，只呈现 reason；二者不能混淆。

## Report、Calculation 与组件

```ts
interface Report {
  readonly id: ReportId;
  readonly calculations: ReportCalculationSet;
  readonly pages: readonly (ReportPage | ReportPageFamily)[];
  readonly downloads: readonly ReportDownload[];
}

declare const defineReport: (definition: {
  readonly id: ReportId;
  readonly calculations?: ReportCalculationSet;
  readonly pages: readonly (ReportPage | ReportPageFamily)[];
  readonly downloads?: readonly ReportDownload[];
}) => Report;
```

`defineReport` 校验 ID 唯一性，并验证 Page / PageFamily / Download 引用的 Calculation object 都在同一个 Report 的 `calculations` 中注册。引用按 object identity，不按 string lookup；作者不能在 callback 中动态增加 Calculation 或 I/O。

这是低层 overload。classic overload（`{ title, pages }`，`render(sample)`）在 [Classic facade](#classic-facade) 一节定义；两种 overload 的结果都进入同一个 closed validation 与 `ReportExecution` 路径。

### Completeness

```ts
type ReportCompleteness = "allow-partial" | "require-complete";
```

任何直接消费 `RecordProjection` 的 Calculation、Page、PageFamily 或 Download 都必须显式声明 completeness：

- `require-complete`：任一 required projected input 不完整时不调用作者 callback，形成 `data-unavailable` result。不完整包括 not-recorded、core-invalid、unavailable、migration-required、migration-unavailable、unsupported 与 invalid。Package-owned dependency 能把对应 logical entry 判为 not-applicable；无法判定则保持 unresolved 并形成 recorded-data problem；
- `allow-partial`：调用 callback，交付穷尽 `ProjectedSample`、coverage 与 issues；host-owned problems surface 仍保留全部问题；
- projection callback throw 不是 partial data。Calculation、fixed Page 与 Download 不执行。`allow-partial` PageFamily 仍可收到穷尽 entries，只从成功的 `attachment-result` 展开实例，但 family/execution problem 不可隐藏，零实例也必须可见。static export 对任一 execution problem fail closed；
- 只消费 `ReportCalculationResult` 的组件总是收到 result union，可以呈现 unavailable，不把它改名为 execution failure。

### Calculation

Calculation 只从静态声明的 projections 派生一个值，不依赖另一个 Calculation。复用公式使用普通纯函数。

```ts
interface ReportCalculation<Inputs extends ReportDataPlan, out Value> {
  readonly id: ReportComponentId;
  readonly inputs: Inputs;
  readonly completeness: ReportCompleteness;
  readonly calculate: (context: {
    readonly sample: AnalysisSample;
    readonly inputs: ReportProjectedValues<Inputs>;
  }) => Value;
}

type AnyReportCalculation = ReportCalculation<any, any>;
type ReportCalculationSet = Readonly<Record<string, AnyReportCalculation>>;

type ReportCalculationResults<Set extends ReportCalculationSet> = {
  readonly [Key in keyof Set]:
    Set[Key] extends ReportCalculation<any, infer Value>
      ? ReportCalculationResult<Value>
      : never;
};

declare const defineCalculation: <
  Inputs extends ReportDataPlan,
  Value,
>(definition: {
  readonly id: ReportComponentId;
  readonly inputs: Inputs;
  readonly completeness: ReportCompleteness;
  readonly calculate: (context: {
    readonly sample: AnalysisSample;
    readonly inputs: ReportProjectedValues<Inputs>;
  }) => Value;
}) => ReportCalculation<Inputs, Value>;
```

`Value` 没有 JSON、codec 或 portability 约束。普通 named interface 可以直接作为结果；execution 在进程内保存原值，host 不重新编码。Callback throw 形成 `calculation-callback-defect`，不是 unavailable、invalid 或 data-unavailable；interruption 保持 Cause。

```ts
interface ReportDataState {
  readonly state: "complete" | "partial";
}

type ReportCalculationResult<Value> =
  | {
      readonly state: "available";
      readonly value: Value;
      readonly inputState: ReportDataState;
    }
  | {
      readonly state: "data-unavailable";
      readonly problemIds: readonly [ReportProblemId, ...ReportProblemId[]];
    }
  | {
      readonly state: "execution-failed";
      readonly problemIds: readonly [ReportProblemId, ...ReportProblemId[]];
    };
```

`inputState` 只声明 required inputs 是否完整，不携带分母。业务 `observed` / `denominator` 属于 Calculation value；host 不从 coverage、entry 数或 access count 推导。

组件共享同一个 context 形状：

```ts
type ReportComponentContext<
  Inputs extends ReportDataPlan | {} = {},
  Calculations extends ReportCalculationSet = {},
> = {
  readonly sample: AnalysisSample;
  readonly inputs: Inputs extends ReportDataPlan
    ? ReportProjectedValues<Inputs>
    : {};
  readonly calculations: ReportCalculationResults<Calculations>;
};
```

### Fixed Page

```ts
declare const definePage: {
  <Calculations extends ReportCalculationSet = {}>(definition: {
    readonly id: ReportComponentId;
    readonly route: ReportRoute;
    readonly inputs?: never;
    readonly completeness?: never;
    readonly calculations?: Calculations;
    readonly render: (
      context: ReportComponentContext<{}, Calculations>,
    ) => ReportDocument;
  }): ReportPage;

  <Inputs extends ReportDataPlan, Calculations extends ReportCalculationSet = {}>(definition: {
    readonly id: ReportComponentId;
    readonly route: ReportRoute;
    readonly inputs: Inputs;
    readonly completeness: ReportCompleteness;
    readonly calculations?: Calculations;
    readonly render: (
      context: ReportComponentContext<Inputs, Calculations>,
    ) => ReportDocument;
  }): ReportPage;
};
```

Fixed Page 的 route 在任何 I/O 前已知。若 `inputs` 非空，TypeScript overload 要求 `completeness`；只消费 Calculation 时不要求虚假的 completeness。

### PageFamily

PageFamily 可以用它静态声明的 projected values 和已注册 Calculation results 纯内存展开动态 route，但不能请求新 I/O。

```ts
declare const definePageFamily: {
  <Instance, Calculations extends ReportCalculationSet = {}>(definition: {
    readonly id: ReportComponentId;
    readonly inputs?: never;
    readonly completeness?: never;
    readonly calculations?: Calculations;
    readonly instances: (
      context: ReportComponentContext<{}, Calculations>,
    ) => Iterable<Instance>;
    readonly key: (instance: Instance) => ReportInstanceKey;
    readonly route: (instance: Instance) => ReportRoute;
    readonly render: (
      context: ReportComponentContext<{}, Calculations> & {
        readonly instance: Instance;
      },
    ) => ReportDocument;
  }): ReportPageFamily;

  <Inputs extends ReportDataPlan, Instance, Calculations extends ReportCalculationSet = {}>(definition: {
    readonly id: ReportComponentId;
    readonly inputs: Inputs;
    readonly completeness: ReportCompleteness;
    readonly calculations?: Calculations;
    readonly instances: (
      context: ReportComponentContext<Inputs, Calculations>,
    ) => Iterable<Instance>;
    readonly key: (instance: Instance) => ReportInstanceKey;
    readonly route: (instance: Instance) => ReportRoute;
    readonly render: (
      context: ReportComponentContext<Inputs, Calculations> & {
        readonly instance: Instance;
      },
    ) => ReportDocument;
  }): ReportPageFamily;
};
```

标准用法包括：每个 Assertion 一页、每个 conversation turn / tool call 一页，以及先由 Calculation 聚合 diagnostics category、再由 PageFamily 展开分类页。Assertion 页的 route 依赖 Assertions Attachment 的 durable `entryId`。若坏 payload 无法提供 durable item key，host 只能保留列表页与问题，不能用数组下标伪造稳定 detail route。

`Instance` 是进程内私有值，不要求 `{ key }` 或 portability；`key(instance)` 单独提供稳定 identity。`key` / `route` callback throw 与 duplicate key 都形成具名 execution problem。family 即使产生零个 instance，也必须在 `ReportExecution.families` 留一条 result；作者不能靠 `flatMap` 或空 family 让坏输入从内建 problems surface 消失。

### Download

```ts
interface ReportDownloadFile {
  readonly path: ReportDownloadPath;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

declare const defineDownload: {
  <Calculations extends ReportCalculationSet = {}>(definition: {
    readonly id: ReportComponentId;
    readonly inputs?: never;
    readonly completeness?: never;
    readonly calculations?: Calculations;
    readonly build: (
      context: ReportComponentContext<{}, Calculations>,
    ) => Iterable<ReportDownloadFile>;
  }): ReportDownload;

  <Inputs extends ReportDataPlan, Calculations extends ReportCalculationSet = {}>(definition: {
    readonly id: ReportComponentId;
    readonly inputs: Inputs;
    readonly completeness: ReportCompleteness;
    readonly calculations?: Calculations;
    readonly build: (
      context: ReportComponentContext<Inputs, Calculations>,
    ) => Iterable<ReportDownloadFile>;
  }): ReportDownload;
};
```

Download bytes 在 execution 中自包含，随静态站一起写出。

## 路由、实例 key 与静态路径

```ts
declare const ReportIdTypeId: unique symbol;
declare const ReportComponentIdTypeId: unique symbol;
declare const ReportRouteTypeId: unique symbol;
declare const ReportInstanceKeyTypeId: unique symbol;
declare const ReportDownloadPathTypeId: unique symbol;

type ReportId = string & { readonly [ReportIdTypeId]: true };
type ReportComponentId = string & { readonly [ReportComponentIdTypeId]: true };
type ReportRoute = string & { readonly [ReportRouteTypeId]: true };
type ReportInstanceKey = string & { readonly [ReportInstanceKeyTypeId]: true };
type ReportDownloadPath = string & { readonly [ReportDownloadPathTypeId]: true };

type ReportPathIssue = {
  readonly code: "report-path-invalid";
  readonly kind: "report-id" | "component-id" | "route" | "instance-key" | "download";
  readonly reason: string;
};

declare const reportId: (input: string) => Either.Either<ReportId, ReportPathIssue>;
declare const reportComponentId: (input: string) => Either.Either<ReportComponentId, ReportPathIssue>;
declare const reportRoute: (input: string) => Either.Either<ReportRoute, ReportPathIssue>;
declare const reportInstanceKey: (input: string) => Either.Either<ReportInstanceKey, ReportPathIssue>;
declare const reportDownloadPath: (input: string) => Either.Either<ReportDownloadPath, ReportPathIssue>;

declare const reportInstanceKeyFromRecordId: (input: {
  readonly kind: "run" | "attempt" | "slot";
  readonly value: RunId | AttemptId | SlotId;
}) => ReportInstanceKey;

declare const reportRouteFromKeys: (
  keys: readonly [ReportInstanceKey, ...ReportInstanceKey[]],
) => Either.Either<ReportRoute, ReportPathIssue>;
```

Route 是 `/`，或 `/` 加 1–32 个 lowercase ASCII segments。Download 是相同语法的 relative segments。Segment 满足 `[a-z0-9][a-z0-9._~-]*`，最多 128 bytes，整条最多 1,024 bytes。它拒绝 percent、query、fragment、backslash、空 segment、`.`、`..`、尾随 `/`、尾点/空格，以及 Windows device name。

Report / component ID 与 Instance key 满足 `[a-z0-9][a-z0-9_-]*`，最多 128 bytes；纯十进制 ordinal 非法，不能用数组下标冒充 durable identity。所有 definition arrays 与结果表按 branded ID 的 UTF-8 bytes 排序；同 ID 冲突在任何作者 callback 前返回 definition invalid，不能依赖 JavaScript object iteration order。

Record 的 `RunId` / `AttemptId` / `SlotId` 不能直接拼入 lowercase route。`reportInstanceKeyFromRecordId` 使用 `run-` / `attempt-` / `slot-` domain tag 加可逆 lowercase Crockford；decode/display 仍恢复并显示原 Record ID。`reportRouteFromKeys` 是唯一把这些 key 组成 route 的 public adapter。Assertions Attachment 的 durable `entryId` 经同一 adapter 进入 per-Assertion route。

Static mapping 唯一且跨平台：

```text
/           → index.html
/a/b        → a/b/index.html
download x  → downloads/x
```

Route outputs、downloads、host-data、built-in runtime 与 manifest 进入同一个 collision set。Host 拒绝 exact collision、ASCII case-fold collision、file/directory prefix collision、Windows device / trailing-dot-space collision 与长度超限。

Static link 不直接写 semantic `/a/b`。Host codec 从当前页面 output 的 POSIX dirname 到 target output file 计算 relative path，separator 固定 `/`，并始终显式包含 `index.html`。Host files 使用保留 namespace `_niceeval`，不属于 author route grammar。

## Closed semantic report tree

classic facade 的受控 JSX 与低层页面 API 都汇入同一棵闭合语义树。树不接受任意 JSON、HTML、DOM、React element、CSS 或 parallel `textAlternative`。

```ts
type ReportScalar = null | boolean | number | string;

type ReportInline =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "code"; readonly value: string }
  | { readonly type: "emphasis"; readonly children: readonly ReportInline[] }
  | {
      readonly type: "link";
      readonly label: readonly ReportInline[];
      readonly target:
        | { readonly kind: "route"; readonly route: ReportRoute }
        | { readonly kind: "download"; readonly path: ReportDownloadPath };
    };

interface ReportDocument {
  readonly title: string;
  readonly children: readonly ReportBlock[];
}

type ReportBlock =
  | ReportSection
  | ReportParagraph
  | ReportList
  | ReportTable
  | ReportMetric
  | ReportStatus
  | ReportCode
  | ReportChart
  | ReportHero
  | ReportSummary
  | ReportRankedBars
  | ReportScatter
  | ReportTreeTable
  | ReportGrid
  | ReportStat
  | ReportCellTable;

interface ReportSection { readonly type: "section"; readonly heading: string; readonly children: readonly ReportBlock[]; }
interface ReportParagraph { readonly type: "paragraph"; readonly children: readonly ReportInline[]; }
interface ReportList { readonly type: "list"; readonly ordered: boolean; readonly items: readonly (readonly ReportBlock[])[]; }
interface ReportTable {
  readonly type: "table";
  readonly caption: string;
  readonly columns: readonly { readonly key: string; readonly label: string; readonly align?: "start" | "end" }[];
  readonly rows: readonly Readonly<Record<string, ReportScalar>>[];
}
interface ReportMetric { readonly type: "metric"; readonly label: string; readonly value: ReportScalar; readonly unit?: string; }
interface ReportStatus { readonly type: "status"; readonly tone: "neutral" | "positive" | "warning" | "negative"; readonly label: string; readonly detail?: readonly ReportInline[]; }
interface ReportCode { readonly type: "code-block"; readonly value: string; readonly language?: string; }
interface ReportChart {
  readonly type: "chart";
  readonly chart: "bar" | "line";
  readonly title: string;
  readonly categoryLabel: string;
  readonly categories: readonly string[];
  readonly series: readonly { readonly label: string; readonly values: readonly (number | null)[] }[];
}

interface ReportHero {
  readonly type: "hero";
  readonly title?: string;
  readonly logo?: { readonly src: string; readonly alt: string };
  readonly description: string;
  readonly links: readonly {
    readonly label: string;
    readonly target: { readonly kind: "external"; readonly href: string };
  }[];
}
interface ReportSummary {
  readonly type: "summary";
  readonly lastRunAt: number | null;
  readonly metrics: readonly ({
    readonly key: string;
    readonly label: string;
  } & ReportDisplayValue)[];
}
interface ReportRankedBars {
  readonly type: "ranked-bars";
  readonly title: string;
  readonly layout: "horizontal";
  readonly points: readonly {
    readonly key: string;
    readonly label: string;
    readonly series: string;
    readonly value: number | null;
    readonly display: string;
    readonly coverage: ReportCoverage;
  }[];
  readonly better: "higher" | "lower";
}
interface ReportScatter {
  readonly type: "scatter";
  readonly title: string;
  readonly xLabel: string;
  readonly yLabel: string;
  readonly connect: boolean;
  readonly series: readonly {
    readonly label: string;
    readonly points: readonly {
      readonly key: string;
      readonly x: number | null;
      readonly y: number | null;
      readonly xDisplay: string;
      readonly yDisplay: string;
      readonly target?: ReportLinkTarget;
    }[];
  }[];
}
interface ReportTreeTable {
  readonly type: "tree-table";
  readonly caption: string;
  readonly columns: readonly {
    readonly key: string;
    readonly label: string;
    readonly align?: "start" | "end";
  }[];
  readonly rows: readonly {
    readonly key: string;
    readonly kind: "experiment" | "eval" | "attempt";
    readonly depth: 0 | 1 | 2;
    readonly label: string;
    readonly target?: ReportLinkTarget;
    readonly cells: Readonly<Record<string, ReportScalar | ReportDisplayValue>>;
  }[];
}

interface ReportGrid { readonly type: "grid"; readonly cells: readonly ReportBlock[]; }
interface ReportStat {
  readonly type: "stat";
  readonly label: string;
  readonly value: string;
  readonly tone?: "neutral" | "positive" | "negative" | "warning";
}
interface ReportCellTable {
  readonly type: "cell-table";
  readonly columns: readonly string[];
  readonly hierarchy?: true;
  readonly rows: readonly {
    readonly key: string;
    readonly kind?: "experiment" | "group" | "eval" | "attempt" | "summary";
    readonly label?: string;
    readonly parentKey?: string;
    readonly target?: ReportLinkTarget;
    readonly cells: Readonly<Record<string, string>>;
  }[];
}
```

`ReportHero`、`ReportSummary`、`ReportRankedBars`、`ReportScatter`、`ReportTreeTable` 与 `ReportCellTable` 对应 classic facade 的内置组件。低层 API 可以直接构造它们。

`ExperimentTable` 使用 `ReportCellTable` 的 `hierarchy: true` 形状表达 Experiment → group / Eval → Attempt。每行用稳定 `key`、`parentKey`、`kind` 与 `label` 描述拓扑，renderer 只负责把这份拓扑呈现成 disclosure。Experiment 与 Attempt 行的可选 target 是 execution 求得的 ordinary exact route，不由 renderer 根据 label 或 locator 猜测。

精确树形状之外还必须做 relational validation：

- number 全部 finite；
- string 只含 Unicode scalar values；
- table column key 非空唯一，row keys 与 columns 恰好相等；
- chart series 长度与 categories 相等；ranked-bars 与 scatter 的非 null 数值全部 finite；
- hero links 的 href 只接受绝对 https；http、javascript、data、file 与 relative 拒绝；
- 缺失 cost / timing 保持 null，不补 0；
- inline route / download link 必须存在于本 execution 的 closure；
- scatter point 与 tree-table row 的 route 是可选实体导航：route 已展开时保留，未展开时删除 target 并继续呈现；非法 target 仍拒绝；
- hierarchy cell-table 的 row key 全局唯一；非 Experiment 行必须引用已有 parent，父子 kind 必须合法且不得形成环；只有 Experiment / Attempt 行可以携带 route target；
- depth、node、string 与 bytes limits 在 active recursion stack 中执行；
- HTML 按 context escape，terminal 把控制字符转成可见文本；renderer 穷尽 union，未知节点类型返回 unsupported。

Web、terminal 与 static text 都从同一棵树派生。Bars 的 label、categories 与 series，以及 scatter 的 points，足以形成 table/text；颜色、hover 与图形不能承载唯一语义。通过率等统计口径由 `passRate` 或 Calculation value 自己定义；host 不替作者公式猜 `observed` / `denominator`。

## 数据问题、执行问题与不可隐藏 surface

```ts
interface ReportRecordedDataProblem {
  readonly category: "recorded-data";
  readonly code:
    | "unavailable"
    | "migration-required"
    | "migration-unavailable"
    | "unsupported"
    | "invalid";
  readonly consumerId: ReportComponentId;
  readonly inputKey?: string;
  readonly slotId?: SlotId;
  readonly runId?: RunId;
}

interface ReportExecutionProblem {
  readonly category: "execution";
  readonly code:
    | "projection-callback-defect"
    | "calculation-callback-defect"
    | "page-family-instances-defect"
    | "page-family-key-defect"
    | "page-family-key-conflict"
    | "page-execution-failed"
    | "download-execution-failed"
    | "semantic-document-invalid"
    | "route-conflict";
  readonly consumerId: ReportComponentId;
  readonly summary: string;
}

type ReportProblem = ReportRecordedDataProblem | ReportExecutionProblem;

type ReportProblemId = number & Brand<"ReportProblemId">;

interface ReportProblemTableEntry {
  readonly id: ReportProblemId;
  readonly problem: ReportProblem;
}
```

`summary` 是固定、bounded 的错误摘要，不携带 payload、secret、Record path 或 raw system cause。Projector 问题在 unique projection cache boundary 只生成一次；logical references 只引用同一个 problem ID。Effect interruption 不编码成 `ReportProblem`。

Host 在作者 callback 之前从完整 Sample / projected results 汇总 applicable recorded-data problems，在 callback 边界再追加 execution problems。Package-owned requiredness dependency 对每条 logical entry 只给出 required、not-applicable 或 unresolved；host 不理解具体 Evaluation kind。Raw projection coverage 保留物理结果，not-applicable 不形成 problem，unresolved 仍形成 problem。

唯一 canonical `problemTable` 去重保存问题；projection、Calculation、Page、Family 与 Download results 只保存 problem ID 引用。show、view 与 static renderer 都从这张表生成不可关闭的 built-in problems surface。作者过滤 entries、返回零 instance 或不画 problem node，都不能删除它。

Recorded-data problems 是可呈现事实，允许形成成功 static export。Projector / author defect、非法 semantic tree 或 route collision 是 execution problem。show/view 可以保留成功页面并显示问题；static export 对任一 execution problem fail closed。

problems surface 必须区分 `migration-required` 与 `migration-unavailable`：前者提示运行 `niceeval migrate`，后者只呈现 reason，不得反复提示迁移命令。

## 一次 ReportExecution

```ts
interface ReportProjectionSummary {
  readonly projectionId: ReportProjectionId;
  readonly inputKey: string;
  readonly coverage: ProjectionCoverage;
  readonly problemIds: readonly ReportProblemId[];
}

type ReportCalculationExecutionResult =
  | {
      readonly state: "available";
      readonly calculationId: ReportComponentId;
      readonly value: unknown;
      readonly inputState: ReportDataState;
      readonly problemIds: readonly ReportProblemId[];
    }
  | {
      readonly state: "data-unavailable" | "execution-failed";
      readonly calculationId: ReportComponentId;
      readonly problemIds: readonly [ReportProblemId, ...ReportProblemId[]];
    };

interface ReportPageFamilyResult {
  readonly familyId: ReportComponentId;
  readonly state: "expanded" | "data-unavailable" | "execution-failed";
  readonly instanceCount: number;
  readonly problemIds: readonly ReportProblemId[];
}

type ReportPageResult =
  | {
      readonly state: "rendered";
      readonly pageId: ReportComponentId;
      readonly route: ReportRoute;
      readonly document: ReportDocument;
      readonly problemIds: readonly ReportProblemId[];
    }
  | {
      readonly state: "data-unavailable" | "execution-failed";
      readonly pageId: ReportComponentId;
      readonly route?: ReportRoute;
      readonly problemIds: readonly [ReportProblemId, ...ReportProblemId[]];
    };

type ReportDownloadResult =
  | {
      readonly state: "built";
      readonly downloadId: ReportComponentId;
      readonly files: readonly ReportDownloadFile[];
      readonly problemIds: readonly ReportProblemId[];
    }
  | {
      readonly state: "data-unavailable" | "execution-failed";
      readonly downloadId: ReportComponentId;
      readonly problemIds: readonly [ReportProblemId, ...ReportProblemId[]];
    };

interface ReportNavigationItem {
  readonly kind: "fixed-page";
  readonly pageId: ReportComponentId;
  readonly order: number;
  readonly title: string;
  readonly route: ReportRoute;
  readonly visible: boolean;
  readonly state: ReportPageResult["state"];
}

interface ReportExecution {
  readonly locale: ReportLocale;
  readonly reportId: ReportId;
  readonly sample: AnalysisSample;
  readonly projections: readonly ReportProjectionSummary[];
  readonly calculations: readonly ReportCalculationExecutionResult[];
  readonly families: readonly ReportPageFamilyResult[];
  readonly pages: readonly ReportPageResult[];
  readonly navigation: readonly ReportNavigationItem[];
  readonly downloads: readonly ReportDownloadResult[];
  readonly problemTable: readonly ReportProblemTableEntry[];
}
```

Execution 不含 reader、root、path、Scope、Stream、callback 或 projector token。它只含 `locale` 选定后的正文，不含另一个 locale 的文档或浏览器 `ViewData`。Calculation value 以原值保存在同一进程的 execution 中；host 不重新编码、不引入 wire 形状。页面与 download renderer 按 component ID 取回 typed result。

`ReportProjectionId` 与 `ReportProblemId` 都是 bounded uint32、从 0 开始连续。Projection IDs 按 canonical declaration traversal 分配；problem IDs 按 stable execution traversal 第一次发现问题的顺序分配。同一 unique projection cache problem 只分配一次。

`projections`、`calculations`、`families`、`pages`、`downloads` 分别按 canonical ID / route / path 排序，不能用 object iteration 猜顺序。`navigation` 只包含 fixed Page 的显式导航声明。它按作者页面声明顺序冻结 title、exact route、visibility 与 execution state；PageFamily 不进入这张表。

每个 declared projection、Calculation、PageFamily、page instance 与 Download 在一个 execution 中最多执行一次。Author graph 的内部 intermediate values 不持久化，也不进入 Record。

## Built-in Reports

`niceeval/report/built-in` 导出 `defaultRunMembershipOverviewReport` 与 factory
`runMembershipOverviewReport()`。这份普通 Report 供一个或多个 explicit Run 形成 bounded
membership 概览。它声明
`selectedRunProjection(membershipProvenanceProjector)` 与
`attemptSlotProjection(verdictProjector)`。CLI 在显式 `--run` 且没有 `--report` 时使用它；其它
selection 不会因此扩大 Attachment 读取范围。

它的稳定表契约、row 值域与截断边界见 [CLI](cli.md#内建-run-membership-概览)。Report 只读取公开
projector 的 `MembershipAction.outcome`，不读取 persisted raw action。Core Member、provenance 与
Verdict 作为三组独立事实并列显示。

`niceeval/report/built-in` 的 `defaultSandboxHistoryReport` 是一份普通、无额外 reader capability 的
history Report。调用点先用公开的 all-runs Analysis selection 形成 Sample；Report 只声明并消费
evaluation plan、Verdict 与 Sandbox 三条 public projection。

它按 exact origin `(runId, attemptId)` 去重。reference Member 只在同一 origin 的 Slot coordinate
列表中出现，不复制 Sandbox Attachment。

每个 origin 显示 origin locator、Verdict、provider、source-native sandbox ID、fresh／pooled 状态。
pooled origin 额外显示 sandbox number 与 ordinal。每条 coordinate 显示当前 Run 的 experiment、eval 与
attempt。

missing coordinate、slot state 和六态 Attachment read result 都留在 Report 的 partial / problems 语义中，
不能被聚合成空历史。

## Effect-native execution

```ts
declare const executeReport: (input: {
  readonly sampleHandle: AnalysisSampleHandle;
  readonly report: Report;
}) => Effect.Effect<ReportExecution, ReportExecutionError, never>;
```

`executeReport` 只能在创建 `AnalysisSampleHandle` 的原 reader Scope 仍存活时调用。capability 已在 handle 的 package-private WeakMap binding 内，不额外写一个 `Scope.Scope` R；R 是 `never`。Pure `AnalysisSample` 不能传入这个入口。reader 关闭、伪造 handle 或另一 reader 的 handle 返回 typed `RecordReadError`；WeakMap 内部错配是 defect。

Library 不调用 `Effect.runPromise`，也不建立私有 runtime。CLI / application main provide Layers 后只在外层调用一次 `Effect.runPromiseExit`；内部不存在 nested `runPromise`。

```ts
const execution = yield* executeReport({ sampleHandle, report });

yield* showReport({ execution });
```

### 从 current Record 直接执行

需要默认产品路径时，host 还提供一次性组合入口。它在内部打开 current reader、形成
`AnalysisSampleHandle` 并完成 execution。

`Effect.scoped` 在返回前释放 reader 与其 maintenance lease。返回的 `ReportExecution`
可以在 Scope 外继续交给 show，或作为 host 创建 view revision 的输入。

```ts
declare const executeReportFromRecord: (input: {
  readonly root: RecordRoot;
  readonly selection: AnalysisSelectionRequest;
  readonly report?: Report;
}) => Effect.Effect<
  ReportExecution,
  RecordReaderOpenError | AnalysisSelectionError | ReportExecutionError,
  RecordFileSystem | RecordMaintenanceLock
>;
```

这个入口不自行安装 `NodeRecordLive`，也不提供 Promise facade。应用边界负责为精确的
`RecordFileSystem | RecordMaintenanceLock` 需求提供自己的 Layer。

0.12 经典 `standard` Report 可从 `niceeval/report/built-in` 的 default export 取得；省略 `report`
时这个组合入口也使用它。它显示 Hero、Sample summary、Experiment scatter、Experiment table 与详情页面。

Record slot 诊断面继续以具名 `defaultOverviewReport` / `overview` 导出。显式选择时，它显示 selected runs、
slot denominator、四种 slot state 与 bounded slot problem list。

## show

```ts
declare const showReport: (input: {
  readonly execution: ReportExecution;
  readonly format?: "text" | "json";
  readonly page?: ReportRoute;
}) => Effect.Effect<void, ReportShowError, ReportConsole>;
```

Text 与 JSON 都从同一 semantic tree、problems 与 execution 派生。`showReport` 不要求 filesystem、server 或 watcher，也不 watch。

`--json` 输出一个固定 schema：reportId、pageSelection、sample 摘要、projections、calculations、families、pages 与 problemTable。Download 部分只含 path / mediaType / byteLength / SHA-256 metadata。它不内联 Download bytes，也不输出第二条 projection 路径。

没有 `--page` 时 pages 按 route 输出全部；有 `--page` 时只输出 exact 选中的一页。sample / projections / calculations / family summaries / download metadata 与 problemTable 仍完整。arrays 按 canonical order，object keys 按 UTF-8 bytes 排序，stdout 是 UTF-8 canonical JSON。

Host 只显示每个 input 的 complete/partial 与 problem IDs，不替作者公式猜 `observed` / `denominator`。Broken pipe 是正常 CLI 退出，其它 console failure 是 typed error，interruption 保持 Cause。

## Node 热重载 host

热重载只在 `niceeval/report/host/node`。它是独立 scoped host service；loader 与 watcher 的具体实现属于该 host，本契约只声明行为。

```ts
interface ReportViewState {
  readonly current: ReportViewRevision;
  readonly lastProblem?: { readonly summary: string };
}

interface ReportViewSession {
  readonly url: string;
  readonly snapshot: Effect.Effect<ReportViewState, ReportViewSessionClosed>;
  readonly refresh: Effect.Effect<void, ReportViewSessionClosed>;
}

class NodeReportViewHost extends Context.Tag(
  "@niceeval/report/NodeReportViewHost",
)<NodeReportViewHost, { readonly open: (
  request: ReportViewRequest,
) => Effect.Effect<ReportViewSession, ReportViewOpenError, Scope.Scope> }>() {}

declare const openNodeReportView: (
  request: ReportViewRequest,
) => Effect.Effect<
  ReportViewSession,
  ReportViewOpenError,
  Scope.Scope | NodeReportViewHost
>;
```

低层 `openNodeReportView` / `openReportViewSession` 保留单个 `ReportExecution` 的 host 组合入口；
它用于已经闭合为英语 execution 的既有调用方。CLI 的 `niceeval view` 使用新增的
`openReportViewClosureSession`，其 revision 原子保存通过验证的 `ViewRevisionClosure`，并把英语
execution 暴露为只读 alias。两种 session 都不接收可由作者构造的浏览器数据对象；没有 closure 的
legacy revision 只服务英语，也不会伪造简体中文切换。

热重载行为：

- 每次 rebuild 用同一份 frozen inputs 产生 `en` 与 `zh-CN` execution；
- 两份 execution 同构后才替换 current revision，并清除 lastProblem；
- 失败保留 last-good revision，替换 bounded lastProblem；
- 每份 execution 都是固定值。热重载创建下一组 execution，不让已经发布的 execution 偷偷重读；
- watch 的输入闭集是 Record root、Report / Theme module 及其静态 import、`niceeval.config.ts`。

HTTP request 与 client interaction 只读取 `ReportViewRevision`。它们不调用 Report callback，也不读取 Record。`NodeReportViewHost` 是可替换的高层 service。官方 Live Layer 内部组合 watcher、server 与 module loader；父调用者不提供或传入 Worker 的 Record service object。Current-process `executeReport` 仍支持调用方自己的 Record Layers。Node ESM module cache 与 watcher 细节由 host 决定，本契约不指定 Worker、bundler 或 wire 形状。

## Static export

```ts
declare const exportStaticReport: (input: {
  readonly execution: ReportExecution;
  readonly out: AbsoluteDirectoryPath;
}) => Effect.Effect<
  ReportStaticExportReceipt,
  ReportExportError,
  ReportFileSystem
>;

declare const exportStaticReportViewClosure: (input: {
  readonly closure: ViewRevisionClosure;
  readonly out: AbsoluteDirectoryPath;
}) => Effect.Effect<
  ReportStaticExportReceipt,
  ReportExportError,
  ReportFileSystem
>;
```

`exportStaticReport` 保留单 execution 的低层导出契约。
CLI 的 `niceeval view --out` 使用 `exportStaticReportViewClosure`。
它消费一个已验证的 `ViewRevisionClosure`，写出两种 locale 对应的 host data，
却只为每条 ordinary canonical route 写一份英语 HTML：

1. preflight execution problems、semantic tree、route、download、limits 与 closure；任一 execution problem 整体不发布；
2. 对这一次 invocation 唯一地 prepare `out`：不存在时创建空目录；
3. 已存在（包括前次失败留下、没有 `complete` 的目录）在写出首字节前返回 `target-exists`；
4. 向 `out` 写出英语 HTML、两种 locale 的 host-data、downloads、manifest 与 built-in runtime，host files 落在保留 namespace `_niceeval`；
5. 全部文件写出后，最后写入零字节 `complete` marker；
6. sync 目录后返回 receipt。

禁用 JavaScript 时英语 HTML 已含完整正文、层级与 ordinary href。runtime 只在原页面切换 closure 中的本地化文本，不新建 locale route、复制 canonical route 或读取 Record。Recorded-data problems 可以导出，并由所有页面不可关闭的 built-in problems surface 显示。目标已存在返回 `target-exists`，不删除或替换既有内容。

中断或失败可能留下没有 `complete` marker 的目录。host 以缺失的 marker 识别 incomplete output，提示用户删除后重试。本契约不承诺原子目录发布，也不依赖原生 rename 原语。

```ts
interface ReportFileSystemService {
  readonly prepareOutput: (
    out: AbsoluteDirectoryPath,
  ) => Effect.Effect<void, ReportFileSystemFailure>;
  readonly writeFile: (input: {
    readonly out: AbsoluteDirectoryPath;
    readonly path: ReportHostOutputPath;
    readonly bytes: Uint8Array;
  }) => Effect.Effect<void, ReportFileSystemFailure>;
  readonly writeCompleteMarker: (
    out: AbsoluteDirectoryPath,
  ) => Effect.Effect<void, ReportFileSystemFailure>;
  readonly syncDirectory: (out: AbsoluteDirectoryPath) => Effect.Effect<void, ReportFileSystemFailure>;
}

class ReportFileSystem extends Context.Tag(
  "@niceeval/report/ReportFileSystem",
)<ReportFileSystem, ReportFileSystemService>() {}
```

`ReportFileSystemFailure` 是 `{ readonly code: "report-export-target-exists" }` 与
`ReportFileSystemError` 的联合。

`prepareOutput` 是 export invocation 的唯一 target-create/check 操作；exporter 在所有 preflight
通过后、首个 `writeFile` 前恰好调用一次。实现不得缓存一次成功的 prepare 结果：同一个
`ReportFileSystemService` 的下一次 export 仍须检查目录；前次失败留下的无 `complete` 目录也返回
`target-exists`，用户删除后才可重试。

`ReportHostOutputPath` 是 `niceeval/report/host` 平台边界类型，不从 author package 导出 constructor。host 用同一 codec 把 route HTML、Download、host-data 与 runtime 变成 canonical segments；Author `ReportDownloadPath` 只是其中一种输入。

## Limits

| 常量 | maximum | 计数范围 |
|---|---:|---|
| `REPORT_PAGES_MAX` | 20,000 | fixed + family-expanded pages |
| `REPORT_DOCUMENT_NODES_MAX` | 20,000 | 每份 semantic document |
| `REPORT_DOCUMENT_DEPTH_MAX` | 32 | 每份 semantic document |
| `REPORT_DOWNLOAD_FILES_MAX` | 1,000 | 全部 downloads |
| `REPORT_DOWNLOAD_FILE_BYTES_MAX` | 33,554,432 | 单一 normalized file buffer |

Logical entries 上限 250,000 由 Projection Library 拥有，Report 不复述。Host 在分配 fixed collection 前检查已知 count，在 Iterable 与 semantic traversal 中累计其余 limits。降低任一 maximum 是 breaking contract，必须发布新 profile；实现不能散落匿名 magic numbers。

```ts
interface ReportLimitExceeded {
  readonly code: "report-limit-exceeded";
  readonly limit: "pages" | "document-nodes" | "document-depth" | "download-files" | "download-file-bytes";
  readonly maximum: number;
  readonly observedAtLeast: number;
}
```

## Typed errors

```ts
type ReportExecutionError =
  | RecordReadError
  | ProjectionLimitError
  | ReportLimitExceeded
  | { readonly code: "report-definition-invalid"; readonly issues: readonly string[] };

type ReportShowError =
  | ReportConsoleError
  | { readonly code: "report-show-render-failed"; readonly operation: string };

type ReportViewOpenError =
  | ReportExecutionError
  | { readonly code: "report-view-open-failed"; readonly reason: string };

type ReportExportError =
  | ReportLimitExceeded
  | { readonly code: "report-export-execution-problem"; readonly problems: readonly ReportExecutionProblem[] }
  | { readonly code: "report-export-target-exists" }
  | { readonly code: "report-export-write-failed"; readonly operation: string };
```

Typed failure、defect 与 interruption 始终分开。公开错误不泄露 payload、secret、任意 filesystem path 或 raw system cause；diagnostic log 可以在显式 debug policy 下写出安全 redaction 后的内部 cause。

## 冻结验收

本契约不能只用 Markdown lint 验收。实现前必须用仓库锁定的 TypeScript 与 `effect@3.22.1` 编译 `fixture/compile.ts`，至少证明：

- 普通 named interface 可以成为 Attachment projector view 与 Calculation value，不需要 index signature、显式 generic 或 `as`；
- wrong owner、projected Value 或 access kind 不能赋值；private TypeId / variance 真实参与 generic structure；
- `reportInputs` 的 key 形状精确推导出 `ProjectedSample<Access, Value>`，不引入第三个 generic 参数；
- 四态 completeness（allow-partial / require-complete）与 data-unavailable / execution-failed 可以区分；
- PageFamily 的 `Instance` 由 `instances` 回调推断，key / route / render 可以消费它；
- `executeReport` 的 R 是 `never`，`showReport` 只要求 `ReportConsole`，`exportStaticReport` 只要求 `ReportFileSystem`；
- `Effect.gen` 组合上述入口、`Either.getOrThrow` 处理 branded constructor 均可编译。

## 相关阅读

- [Reports README](README.md)：用户心智与功能边界。
- [Architecture](architecture.md)：Record → Analysis → Projection → Report → host 的层次。
- [Calculations](calculations.md)：通过率、score 与 completeness。
- [Projection Library](../projection/library.md)：`RecordProjection`、`ProjectedSample` 与 coverage。
- [Sample Library](../sample/library.md)：Sample、slot 状态与 live handle。
- [Record Library](../record/library.md)：Attachment family 与读取状态。
