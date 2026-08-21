# Report Library（报告库）

本页定义 `niceeval/report` 的作者 API 和 package export manifest。普通作者只导入这里列出的作者入口；Record reader、模块装载、
watch、文件目录与 `ClosedSiteRevision` 不进入作者 callback。

## 公共出口与 API 裁决

Report 只发布下表中的 package path 和符号。每一项都列出最终源码 owner；未列出的 path 或符号不构成公共 API。作者入口不发布
NiceEval JSX runtime、generic semantic author model、Record capability 或 Host 内部页值。

| package path 与最终源码 owner | runtime exports | type-only exports |
|---|---|---|
| `niceeval/report` · `definition/report.ts` 与 `analysis/cost.ts` 的 re-export | `defineReport`、`definePricingProfile`、`builtInPricingProfile` | `ReportDefinition`、`ReportShell`、`ReportMeta`、`ReportMetaPage`、`PricingProfile`、`PricingProfileInput`、`PricingProfileContentIdentity`、`PricingCoverageId`、`PricingCoverage`、`PricedCoverage`、`UnpricedCoverage`、`PricingCoverageInput`、`PricedCoverageInput`、`UnpricedCoverageInput`、`PricingSelector`、`PricingSelectorInput`、`PricingEffectiveCondition`、`PricingEffectiveConditionInput`、`PricingCharge`、`PricingChargeInput`、`PricingDisplay`、`PricingDisplayInput`、`PricingProvenance`、`PricingProvenanceInput`、`Page`、`PlainPage`、`ParameterizedPage`、`PageParams`、`PageLoad`、`PageLoadContext`、`PageContext`、`PageEvidence`、`HeadTag`、`Sample` |
| `niceeval/report` · `definition/tree.ts` | `defineComponent` | `ComponentContext`、`ComposeContext`、`ResolveContext`、`ComponentFaces`、`ReportComponent`、`TextContext`、`WebContext` |
| `niceeval/report` · `model/{aggregate,metrics}.ts` 与 `analysis/**` | `aggregate`、`agent`、`attempt`、`evalId`、`experiment`、`model`、`reasoningEffort`、`flag`、`label`、`passRate`、`durationMs`、`tokens`、`costUSD`、`totalCostUSD`、`evidenceRow` | `AggregationSubject`、`GroupFunction`、`EvidenceRow`、`ClosedRows`、`MetricValue`、`MetricState`、`MeasureFormat`、`AnalysisIssue`、`EvidenceRef`、`CostMeasure`、`CostMetricValue`、`CostProjectionValue`、`CostProjectionKnown`、`CostProjectionMigrationRequired`、`CostProjectionUnavailable`、`CostProjectionState`、`CostBasis`、`CostProjectionAggregate`、`CostProjectionProfile`、`CostLedgerEntry`、`CostCoverageReason`、`CostCoverageReasonCode`、`ProjectedMoney`、`ObservedCostComponent`、`EstimatedTokenCostComponent`、`EstimatedRequestCostComponent`、`ObservedOtherCurrency` |
| `niceeval/report` · `model/conversions.ts` 与 `analysis/domain-view.ts` | `toAttemptEvidence`、`toAttemptObservability`、`toFileChanges`、`toSources`、`toSandboxHistory`、`toEvidenceRows`、`toIssueRows`、`toIssueText`、`toMetricDetailRow` | `AttemptEvidenceDomainView`、`AttemptObservabilityDomainView`、`FileChangesDomainView`、`SourcesDomainView`、`SandboxHistoryDomainView`、`MetricDetailRow` |
| `niceeval/report` · `theme.ts`、`presentation.ts`、`model/{format,locale,text-layout}.ts` | `defineTheme`、`basalt`、`chalk`、`presentDimension`、`shortestUniqueLabels`、`formatAxisTick`、`formatInstant`、`formatMetricValue`、`formatTimeDistance`、`missingText`、`stringWidth`、`padEnd`、`padStart`、`wrapText`、`indent`、`bar`、`columns`、`DEFAULT_REPORT_LOCALE`、`localizedTextEquals`、`resolveLocalizedText`、`resolveMetricLabel` | `ThemeDefinition`、`ReportTheme`、`ThemeColor`、`ThemeHex`、`ThemeSeries`、`MetricFormat`、`LocalizedText`、`ReportLocale`、`ColumnAlign`、`DimensionDeclaration`、`DimensionEncoding`、`PresentedDimension` |
| `niceeval/report` · `definition/primitives.tsx` 与 `definition/primitives/**` | `Area`、`Bars`、`Callouts`、`Chart`、`Col`、`CommandEvidence`、`Conversation`、`TurnTrace`、`CopyBlock`、`DiffView`、`Grid`、`Line`、`Link`、`Markdown`、`Row`、`Scatter`、`Section`、`Series`、`SourceView`、`Stat`、`Style`、`Tab`、`Table`、`Tabs`、`Text`、`Waterfall`、`applyBarsSortLimit` | `AreaProps`、`BarsProps`、`BarsSort`、`CalloutGroup`、`CalloutItem`、`CalloutLevel`、`CalloutsProps`、`ChartProps`、`ColProps`、`CommandEvidenceContent`、`CommandEvidenceItem`、`CommandEvidenceProps`、`ConversationContent`、`ConversationEntry`、`ConversationProps`、`TurnTraceProps`、`CopyBlockContent`、`CopyBlockProps`、`DiffChange`、`DiffContent`、`DiffFile`、`DiffViewProps`、`GridProps`、`LayoutProps`、`LineProps`、`MarkdownProps`、`RowProps`、`ScatterProps`、`SectionProps`、`SeriesProps`、`SourceContent`、`SourceViewProps`、`StatProps`、`StyleProps`、`TabProps`、`TableProps`、`TabsProps`、`TextProps`、`WaterfallContent`、`WaterfallNode`、`WaterfallProps` |
| `niceeval/report` · `definition/cell.tsx` | 无 | `Cell`、`VerdictCounts` |
| `niceeval/report` · `components/{site-components,summaries,entity-lists,attempt-detail,experiment-detail}/**` 与 `library/details.ts` | `Hero`、`HeroCard`、`PoweredBy`、`RunNotices`、`SampleFixPrompt`、`SampleNotices`、`ExperimentScatter`、`SampleOverview`、`SampleSummary`、`StabilityOverview`、`AttemptList`、`ExperimentTable`、`FailureList`、`AttemptAssessment`、`AttemptDetails`、`AttemptSummary`、`ExperimentDetails` | `HeroProps`、`HeroCardProps`、`HeroLink`、`HeroLogo`、`RunNoticesProps`、`SampleFixPromptProps`、`SampleNoticesProps`、`ExperimentScatterProps`、`SampleOverviewProps`、`SampleSummaryProps`、`StabilityOverviewProps`、`AttemptListProps`、`ExperimentTableProps`、`FailureListProps`、`AttemptDetailsProps`、`ExperimentDetailsProps`、`AttemptDetailTarget`、`ExperimentDetailTarget`、`LibraryDetailTarget` |
| `niceeval/report/built-in` · `built-in/standard.tsx` 与 `library/details.ts` | `standard`、`standardOverviewPage`、`standardAttemptPage`、`standardExperimentPage`、`attemptDetailTarget`、`attemptDetailRoute`、`experimentDetailTarget`、`experimentDetailRoute`、`libraryDetailRoute` | `AttemptDetailTarget`、`ExperimentDetailTarget`、`LibraryDetailTarget` |
| `niceeval/report/react` · `react/index.ts`（`Cell`、`VerdictCounts` re-export 自 `definition/cell.tsx`） | `Callouts`、`Chart`、`Col`、`Conversation`、`TurnTrace`、`CopyBlock`、`DiffView`、`Grid`、`Row`、`Section`、`Series`、`SourceView`、`Stat`、`Style`、`Tab`、`Table`、`Tabs`、`Text`、`Waterfall`、`HeroCard`、`PoweredBy`、`formatCellText`、`formatAxisTick`、`formatInstant`、`formatMetricValue`、`formatTimeDistance`、`DEFAULT_REPORT_LOCALE`、`localizedTextEquals`、`resolveLocalizedText`、`resolveMetricLabel` | `Cell`、`VerdictCounts`、`LocalizedText`、`ReportLocale`、`MetricValue` |
| `niceeval/report/extension` · `extension/{define,meta,types,assets}.ts` | `defineRenderer`、`rendererMetaOf`、`isRendererComponent` | `RendererFaces`、`RendererProps`、`RendererOptions`、`RendererAssetDeclaration`、`RendererMeta`、`RendererTextContext`、`RendererWebContext` |
| `niceeval/report/host` · `host/**` 与 `execution/**` | `reportHost` | `ClosedSiteRevision` |
| `niceeval/report/react/styles.css` · `assets/styles.css` | Report 产品 CSS 文件 | 无 |
| `niceeval/report/react/enhance.js` · `assets/enhance.js` | Report 渐进增强脚本 | 无 |

`niceeval/jsx-runtime`、`niceeval/jsx-dev-runtime`、`niceeval/report/jsx-runtime` 与
`niceeval/report/jsx-dev-runtime` 没有 package export。`ReportElement`、`ReportNode`、`ClosedReportNode` 与通用 semantic tree
也没有作者导出。

`Cell` 与 `VerdictCounts` 的唯一声明 owner 是 `definition/cell.tsx`。root `niceeval/report` 以 type-only export 提供它们；
`metric` Cell 默认显示完整的 `MetricValue`。只有相邻的命名区域已经显示同一份结果完整度时，才可设 `showCoverage: false` 让该格只显示业务值；
这不会删除 `metric` 自身的 state、samples、total、issues 或 refs。
`niceeval/report/react` 只 re-export 同一对类型，既不声明第二份类型，也不做转换。

### 作者调用形状

| 符号 | 最终调用形状 | 最终源码 owner |
|---|---|---|
| `defineReport` | 单页 callback，或 `{ title?, theme?, dimensionPins?, pricing?, head?, pages }`。 | `definition/report.ts` |
| `definePricingProfile` | 声明 USD rate card；只能由 `ReportDefinition.pricing` 持有。 | `analysis/cost.ts`（经 `niceeval/report` re-export） |
| `Page`、`PlainPage`、`ParameterizedPage` | 普通页的 `load?` / `render`，参数页的 `params` / `load` / `render` / `navigation: false`。 | `definition/report.ts` |
| `defineComponent(compose)` | `(props, ctx) => ReactNode \| Promise<ReactNode>`；Sample 只从 `ctx.scope` 读取。 | `definition/tree.ts` |
| `defineComponent(faces)` | `{ resolve?, text, web }`；`text` 与 `web` 同步读取一次关闭输入。 | `definition/tree.ts` |
| `ctx.report` | `{ title, pricing, pages }` 的只读 `ReportMeta`。 | `definition/report.ts` 与 `definition/tree.ts` |
| 标准 JSX | `jsx: "react-jsx"` 与 `react/jsx-runtime`。 | TypeScript / React；Report 不另发 JSX runtime。 |
| `HeadTag` | 结构化 `meta`、`link`、`style`、`script`。 | `definition/report.ts` |
| 原语与官方组件 | `Area` 至 `Waterfall`，以及 `Hero`、summary、entity list、Attempt / Experiment detail 组件。 | `definition/primitives/**` 与 `components/**` |

`AggregationSubject` 是只读的冻结值，不提供可读 Run。它的完整公开形状如下：

```ts
interface AggregationSubject {
  readonly experimentId: string;
  readonly evalId: string;
  readonly run: {
    readonly experiment?: {
      readonly agent: string;
      readonly model?: string;
      readonly reasoningEffort?: string;
      readonly flags: Readonly<Record<string, JsonValue>>;
      readonly labels: Readonly<Record<string, string>>;
    };
  };
}
```

`GroupFunction` 只能从 `subject.run.experiment?.agent`、`model`、`reasoningEffort`、`flags` 与 `labels` 读取分组键，
不能打开 Record、取得 AttemptHandle 或查看其它 Run 字段。

`condition` 不是 `niceeval/report` 的 export。需要该维度的 Report 在自身模块中声明
`const condition: GroupFunction = …`；MemoryBench 的 leaderboard 也以这个形态声明它。

未列入上方 manifest 的符号不构成作者 API。`ReportElement`、`ReportNode`、`ClosedReportNode`、NiceEval JSX runtime、可读
Record / Run / Sample handle、任意 reducer 以及 handle converter 都不发布。
作者只使用标准 React JSX、关闭 DomainView 和 Analysis-issued 值。

公共出口的每次变更都以最小纵向样例固定其调用点。该样例是一个普通 `.tsx` Report module，只设置
`"jsx": "react-jsx"`。

它同时使用 `defineReport()`、两种 `defineComponent()`、一个参数 Page、`aggregate()`、`MetricValue`、`ctx.scope` 与
`ctx.report`。安装后的候选包必须以它运行 `show`、`show --json`、`view` 与 `view --out`，且不依赖特殊 tsconfig、pragma 或源码路径。

## 成本投影入口

`definePricingProfile()` 的唯一作者位置是 `ReportDefinition.pricing`；省略时 `defineReport()` 使用 `builtInPricingProfile`。组件从只读
`ctx.report.pricing` 取得最终已验证值。
本页的 export manifest 列出作者可导入的价格与成本类型。精确的 `PricingProfileInput`、规范化输出、跨包识别、Measure 参数和成本
投影语义由 [Report 成本投影 Library](cost-projections/library.md) 单点定义。

## 标准 React JSX 与 `defineReport()`

```json
{
  "compilerOptions": {
    "jsx": "react-jsx"
  }
}
```

`defineReport()` 是 Report module 的默认导出。它接收一个单页 callback，或接收带非空 `pages` 的声明。定义阶段只校验静态形状，
不打开 Sample 或执行 Page。`ReportDefinition.pricing` 是价格配置的唯一所属位置：对象形式从 `ReportShell.pricing` 取得已验证
Profile；未声明时归一为随包 `builtInPricingProfile`，单页 callback 取得同一默认值。

```ts
interface ReportShell {
  readonly pricing?: PricingProfile;
  readonly pages: readonly [Page, ...Page[]];
  // title、theme、dimensionPins、head 等其它 Report 声明字段
}

interface ReportDefinition {
  readonly pricing: PricingProfile | null;
  // 已验证、归一化的 Report 声明
}

declare function defineReport(
  render: (sample: Sample) => React.ReactNode | Promise<React.ReactNode>,
): ReportDefinition;

declare function defineReport(definition: ReportShell & {
  readonly pages: readonly [Page, ...Page[]];
}): ReportDefinition;
```

`head` 接收结构化标签。`HeadTag` 的 tag 是 `meta`、`link`、`style`、`script`
闭集，`attrs` 是 `Record<string, string | true>`。Host 在形成 revision 前继续按 tag 校验允许的属性、URL 与
内联内容；宽泛的作者推断不等于 raw HTML 或任意 DOM 注入。

```tsx
import { defineReport, type HeadTag } from "niceeval/report";

const head: readonly HeadTag[] = [
  { tag: "meta", attrs: { name: "robots", content: "noindex" } },
  {
    tag: "script",
    attrs: {
      src: "https://cdn.example.test/chart-enhance.js",
      defer: true,
      integrity: "sha384-example",
      crossorigin: "anonymous",
      referrerpolicy: "no-referrer",
    },
  },
];

export default defineReport({
  title: { en: "Quality", "zh-CN": "质量" },
  head,
  pages: [{ id: "overview", path: "/", title: "Overview", render: () => null }],
});
```

内联 script 的 `children` 是明确的字符串 bytes；标签顺序、属性和 bytes 都进入站点 identity。需要价格配置时，作者按
[Report 成本投影 Library](cost-projections/library.md) 的完整 rate-card 示例声明它，再放入同一对象的 `pricing`。

`style` 必须有 `children`；带 `src` 的 script 不能同时给 `children`。script 可以加强交互，不能承担正文、导航、Evidence 或核心数据读取。

Codex sealed Usage 的 model request observation、零费率的显式声明和严格 coverage 的结果，都由
[Report 成本投影 Library](cost-projections/library.md) 定义。

## Page

`pages` 是 Report 的唯一 Page 集合；Host 不回填、推断或自动生成详情页。普通 Page 的 `load` 省略时，`render` 直接收到 Host 签发的
Sample。参数 Page 以 `params` 表示可寻址实例，并固定为 `navigation: false`。Attempt、Experiment 或任意其它详情都必须由作者作为
`ParameterizedPage` 显式放入 `pages`，才能成为 route 或静态输出的一部分。

```ts
interface PlainPage<Input = Sample> {
  readonly id: string;
  readonly path?: string;
  readonly title: LocalizedText;
  readonly navigation?: boolean;
  readonly load?: (
    sample: Sample,
    params: void,
    ctx: PageLoadContext,
  ) => Input | Promise<Input>;
  readonly render: (
    input: Input,
    ctx: PageContext,
  ) => React.ReactNode | Promise<React.ReactNode>;
}

interface ParameterizedPage<Params extends JsonValue, Input> {
  readonly id: string;
  readonly path?: string;
  readonly title: LocalizedText;
  readonly navigation: false;
  readonly role?: {
    readonly kind: "experiment-group";
    readonly groupKind: "named" | "singleton";
  };
  readonly params: PageParams<Params>;
  readonly load: (
    sample: Sample,
    params: Params,
    ctx: PageLoadContext,
  ) => Input | Promise<Input>;
  readonly render: (
    input: Input,
    ctx: PageContext,
  ) => React.ReactNode | Promise<React.ReactNode>;
}

type Page<Params extends JsonValue | void = void, Input = Sample> =
  [Params] extends [void]
    ? PlainPage<Input>
    : ParameterizedPage<Extract<Params, JsonValue>, Input>;
```

`role.kind: "experiment-group"` 只适用于参数 Page。`groupKind` 固定该 Page 接收 named 或 singleton identity，`load` 再从当前 Sample 形成 `ExperimentComparisonScope`。Host 只为作者显式声明的这类 Page 生成 Header 实验选择器；当前 Sample 只有一个可比范围时不显示选择器，有两个或更多时才显示，并默认选择稳定排序的第一项。未声明该 role 时不补造 Page、route 或选择器。

参数 Page 仍只消费一个 canonical key segment。标准 Report 因此显式声明 `path: "/group/named"` 和 `path: "/group/singleton"` 两个 Page，形成 `/group/named/<segment>` 与 `/group/singleton/<experiment-id>`。选择器把两个 Page 的已闭合目标汇总成一个原生 `select`；切换只导航到选项携带的静态 Page URL。禁用 JavaScript 时，Header 提供同一组真实链接作为 fallback，静态导出仍能切换组。

标准实验组 Page 是完整的 scoped Overview，不是只替换 Experiment Table。它把 `ExperimentComparisonScope` 的 backing Sample 显式交给 Hero、`SampleNotices` 与 `SampleSummary`，再把同一 scope 交给 `ExperimentScatter` 和 `ExperimentTable`。因此告警数、Pass rate、Experiments、Evals、Attempts、Eval results、Total cost 与 Run range 都随选择范围变化。

`params.encode()` 产生一个 canonical key segment；`decode()` 只接受同一形式。全站路径调用 `enumerate(sample)` 恰好一次，
并生成每个返回值。`show --page` 只用 `decode()` 取得已请求 key，不调用 `enumerate()`。

```tsx
import {
  defineReport,
  type Page,
  type PageParams,
  Table,
} from "niceeval/report";

type SummaryParams = { readonly state: "all" | "failed" };

const summaryParams: PageParams<SummaryParams> = {
  encode: ({ state }) => state,
  decode: key => {
    if (key !== "all" && key !== "failed") throw new TypeError("unknown summary state");
    return { state: key };
  },
  enumerate: () => [{ state: "all" }, { state: "failed" }],
};

const summaryPage: Page<SummaryParams, SummaryParams> = {
  id: "summary",
  path: "/summary",
  title: "Summary",
  navigation: false,
  params: summaryParams,
  load: (_sample, params) => params,
  render: params => <Table rows={[params]} />,
};

export default defineReport({ pages: [summaryPage] });
```

若参数是 Attempt locator、identity 或其它 Sample member，`PageLoadContext.evidence(locator)` 与每个公开 DomainView 入口都只交出
当前 Sample 内的闭合值。它们不提供 Record reader、目录、任意路径或浏览器请求能力。

## 两种 `defineComponent()`

组合组件的 callback 可以异步取得 Sample 上的闭合值。Sample 只从 `ctx.scope` 读取。`ctx.report` 是一个只读 `ReportMeta`，包含
归一后的 `title`、已验证 `PricingProfile` 或 `null` 的 `pricing`，以及导航 Page 摘要；它不提供 `head`、theme、Record reader 或
当前 route 以外的读取能力。`ctx.report.pricing` 不是第二份价格输入，也不是 Runner 配置或运行期价格表。

```ts
interface ComponentContext {
  readonly scope: Sample;
  readonly report: ReportMeta;
  readonly page: PageContext;
}

interface ReportMeta {
  readonly title: LocalizedText;
  readonly pricing: PricingProfile | null;
  readonly pages: readonly {
    readonly id: string;
    readonly title: LocalizedText;
    readonly navigation: boolean;
  }[];
}
```

```tsx
import {
  aggregate,
  Bars,
  defineComponent,
  Grid,
  model,
  passRate,
  Section,
  Table,
} from "niceeval/report";

const Overview = defineComponent(async (_props: {}, ctx) => {
  const rows = await aggregate(ctx.scope, {
    by: { model },
    values: { passRate },
  });

  return (
    <Section title={ctx.report.title}>
      <Grid>
        <Bars points={rows} x="model" y="passRate" />
        <Table rows={rows} />
      </Grid>
    </Section>
  );
});
```

双面组件适合已有关闭数据的显示原语。可选 `resolve` 字段只在 Page 执行时调用一次；`text()` 和 `web()` 必须同步，且都只读取
这个关闭值。它们不能读取 Sample、发网络请求或各自计算统计。

```tsx
import {
  defineComponent,
  formatMetricValue,
  Stat,
  type MetricValue,
} from "niceeval/report";

const MetricCard = defineComponent<{ readonly label: string; readonly value: MetricValue }, {
  readonly label: string;
  readonly value: MetricValue;
}>({
  resolve: (props, ctx) => {
    const reportTitle = typeof ctx.report.title === "string"
      ? ctx.report.title
      : (ctx.report.title.en ?? "Report");
    return { label: `${reportTitle}: ${props.label}`, value: props.value };
  },
  text: data => `${data.label}: ${formatMetricValue(data.value)}`,
  web: data => <Stat label={data.label} value={formatMetricValue(data.value)} />,
});
```

第一种形态适合组织 Page；第二种形态适合定义 text/web 一致的显示原语。两者返回的组件都能放进标准 React JSX。

## `aggregate()` 与 `MetricValue`

`aggregate()` 是 Analysis executor 的 Report facade。它只接收 Host 签发的 Sample，返回 `ClosedRows`；它不是第二套 reducer，
也不接受可读 Attempt、Record root 或手写分母。

```tsx
import { aggregate, defineComponent, model, passRate, Table } from "niceeval/report";

const QualityTable = defineComponent(async (_props: {}, ctx) => {
  const rows = await aggregate(ctx.scope, {
    by: { model },
    values: { passRate },
  });

  return <Table rows={rows} />;
});
```

`GroupFunction` 只观察冻结 Run context 中的 `experimentId`、`evalId`、`agent`、`model`、`reasoningEffort`、`flags` 与 `labels`。
它不能取得 reader、AttemptHandle 或重新打开 Record。`rollup()`、`metricValue()`、`totalScore`、Attempt converter 和任意 reducer
没有 Report export。

`MetricValue` 由 Analysis 生成，Report 只 re-export 它的类型：

```ts
interface MetricValue {
  readonly value: number | null;
  readonly state: "available" | "partial" | "empty" | "unsupported" | "failed";
  readonly samples: number;
  readonly total: number;
  readonly basis: "attempt" | "eval" | "run" | "pair" | "slot";
  readonly issues: readonly AnalysisIssue[];
  readonly refs: readonly EvidenceRef[];
  readonly unit?: string;
  readonly format?: MeasureFormat;
  readonly better?: "higher" | "lower" | "neutral";
  readonly bounds?: { readonly min?: number; readonly max?: number };
}
```

`value: 0` 是合法读数。`partial` 保留既定 `total`、`issues` 与 `refs`；显示排序、筛选和截断只改变可见项目，不能改写任一
`MetricValue` 字段。完整状态语义由 [读数与显示语义](calculations.md) 拥有。

## 成本 Measure 整合

成本组件使用 `ctx.report.pricing` 请求成本 Measure；旧的跨包 `null` 防御只用于拒绝或降级非当前定义。export manifest 中的 `CostMetricValue` 与
`CostProjectionValue` 是作者可观察类型。`aggregate(costUSD(profile))` 的 cell 以 `cell.projection` 提供关闭投影；state、basis、
ledger 与 reason data types 同样仅以 type-only export 提供。精确调用形状、无 Profile 呈现、Analysis 数学与 machine 读数由
[Report 成本投影 Library](cost-projections/library.md) 和 [CLI](cost-projections/cli.md) 定义。

## 中立组件与官方组合组件

`Table` 接收 `rows`，`Bars`、`Line` 与 `Scatter` 接收 `points`，`Stat` 接收 format 后的显示值。它们不知道值来自 Analysis、
业务数组或已关闭领域视图，也不会自行读取数据。

`Hero`、`SampleOverview`、`AttemptDetails`、`ExperimentDetails`、`Conversation`、`TurnTrace`、`DiffView`、`SourceView` 与 `Waterfall` 是
官方组合组件。它们只接收关闭数据，详情 route 一律通过 `attemptDetailTarget()`、`experimentDetailTarget()` 与
`libraryDetailRoute()` 建立。

`ExperimentTable` 与 `ExperimentScatter` 是具名比较组件。它们只接受 `ExperimentComparisonScope` 或该 scope 产生的同组 branded projection，不接受普通 Sample 或任意 rows。多组输入以 `analysis-comparison-group-mismatch` 失败；单组的 `non-comparable` 闭合原因与 Evidence，不渲染排名或散点。中立 `Table` 与 `Scatter` 仍可显示任意已闭合值，不承担实验组语义。

`AttemptDetails` 把 source navigation 精确关联的每次物理 `send` 嵌回对应源码行。Assertion 展开区先显示判定、完整度与 matcher 已经封口的决定性见证，例如期望、实际命中次数和位置；它不把整棵 matcher diagnostic JSON 当作用户文案。展开 `send` 所在行后，`TurnTrace` 以 `Conversation` 的静态因果事件流为账本，加上 turn 时间概览与可关闭的事件 inspector。

匹配同一 call ID 的工具调用和结果在调用位置组合成一个生命周期节点，inspector 同时保留输入与结果证据；未闭合或无法唯一配对的阶段仍各自显示。节点状态和颜色只使用 provider-neutral outcome：`completed`、`failed`、`rejected` 或 `cancelled`；原始工具名和 output 字段不参与 View 判断。没有精确 source mapping 的 turn 保留在页面级 `TurnTrace`，不按源码顺序猜测归属；没有 JavaScript 时 inspector 不出现，但完整事件内容仍在正文中。

下载文件属于 Host 的站点闭包：view 与静态写出只读取已关闭的 bytes。作者入口不发布一个 generic `Download` 组件或
`DownloadFile` 类型；这避免把尚无最终 primitive owner 的 generic semantic API 写进公共契约。

## 跨重复包的描述符身份

`defineReport()`、`defineComponent()` 和 `defineRenderer()` 的运行时 descriptor 使用版本化 `Symbol.for` key。
对应 key 是：

- Report definition：`niceeval.report.definition/v2`
- component faces：`niceeval.report.component/v1`
- extension metadata：`niceeval.report.renderer/v1`

应用依赖图中出现两份 NiceEval 时，Host 仍能识别同一版本的作者定义与组件 descriptor。PricingProfile 的
`pricing-profile/v1` descriptor 以及它与 `definition/v2` 的重验关系由
[Report 成本投影 Architecture](cost-projections/architecture.md) 定义；不得依赖 `instanceof`、对象地址或模块私有 symbol。

## Host 边界

普通作者不调用 `reportHost`。高级 Host 只能从 `niceeval/report/host` 调用它：`show()` 是单目标执行，`serve()` 与 `export()`
只消费完整站点闭包。这个出口不泄漏 loader、watcher 或 reader，也不把 `ClosedSiteRevision` 交给作者 callback。

构建错误、坏参数 key、route 冲突、asset 冲突或限额超出阻止相应交付。Analysis 数据问题继续作为 `MetricValue`、领域视图和
问题表的一部分显示。

## 相关阅读

- [Reports README](README.md)：两条执行路径与产品范围。
- [读数与显示语义](calculations.md)：统计口径、MetricValue 与 DomainView。
- [Architecture](architecture.md)：站点版本、CSS、reload、缓存与预算。
- [CLI](cli.md)：route 选择、机器输出、view 与静态导出。
