# Library

本页是 Capture、Analysis 与 Report 公共 API 的单一契约。完整用户任务见 [Use Case](use-case/README.md)。

## Import surface

| 子路径 | 面向谁 | 导出什么 | 不导出什么 |
|---|---|---|---|
| `niceeval` | 普通 Eval 作者 | `defineEval`、领域 Plugin 消费入口、`TestContext` | Record writer、Capture constructor、projection |
| `niceeval/capture` | 领域 SDK 与高级 Eval 作者 | typed definitions、Capture tokens、rubric 与 label constructors | RecordAttachment、schema version、converter、installation |
| `niceeval/analysis` | 领域 SDK 与 Analysis 作者 | population、Dimension、Measure、relation、`analyze()` | Record reader、raw Attachment、renderer |
| `niceeval/report` | Report 作者 | `ReportSample`、`aggregate()`、Page、components、`defineReport` | raw Sample members、projection、migration、Effect runtime |
| `niceeval/report/host` | NiceEval CLI host | scoped execution facade | Capture capability、maintenance capability |
| `niceeval/record/host` | NiceEval runner 与 maintenance host | internal root facets | application author API |

普通 application 不注册事实 family，也不把 executable capability 安装进 Record host。

## Capture definitions

### MetricDefinition

`defineMetric()` 声明有限数值事实的长期含义：

```ts
import {
  defineMetric,
  enumLabel,
  optionalEnumLabel,
} from "niceeval/capture";

export const gpuEnergyMetric = defineMetric({
  id: "com.example.gpu-energy",
  unit: "J",
  labels: {
    source: enumLabel(["device-estimate", "nvml"]),
    device: optionalEnumLabel(["gpu-0", "gpu-1"]),
  },
  uncertainty: "absolute",
});
```

```ts
interface MetricDefinitionOptions<Labels extends MetricLabels> {
  readonly id: string;
  readonly unit: string;
  readonly labels?: Labels;
  readonly uncertainty?: "none" | "absolute";
}

declare function defineMetric<const Labels extends MetricLabels = {}>(
  options: MetricDefinitionOptions<Labels>,
): MetricDefinition<Labels>;

declare function enumLabel<const Values extends readonly string[]>(
  values: Values,
): RequiredEnumLabel<Values[number]>;

declare function optionalEnumLabel<const Values extends readonly string[]>(
  values: Values,
): OptionalEnumLabel<Values[number]>;
```

Metric value 必须是 finite number。定义只允许预声明的低基数 string enum labels，不接受 runtime 新 key、自由 string、number
label 或 JSON。

候选硬边界如下：

| 对象 | 上限 |
|---|---|
| definition ID | 160 个 ASCII 字符 |
| label keys | 8 个；每个 key 64 个 ASCII 字符 |
| 每个 label 的 enum members | 64 个；每个值 128 UTF-8 bytes |
| 一个 seal 的 coordinate cells | 256 个 |

### ScoreDefinition

`defineScore()` 声明一次 evaluator invocation 能产生的固定 rubric bundle：

```ts
import {
  booleanRubric,
  defineScore,
  enumRubric,
  numberRubric,
} from "niceeval/capture";

export const dataQualityScore = defineScore({
  id: "com.example.data-quality",
  rubrics: {
    correctness: numberRubric({ min: 0, max: 1, required: true }),
    safe: booleanRubric({ required: true }),
    freshness: enumRubric(["fresh", "stale"], { required: false }),
  },
});
```

```ts
interface ScoreDefinitionOptions<Rubrics extends ScoreRubrics> {
  readonly id: string;
  readonly rubrics: Rubrics;
}

declare function defineScore<const Rubrics extends ScoreRubrics>(
  options: ScoreDefinitionOptions<Rubrics>,
): ScoreDefinition<Rubrics>;
```

一个 Score 最多声明 64 个 rubrics。每个 rubric ID 最多 64 个 ASCII 字符；enum rubric 最多 64 个 members，每个 member
最多 128 UTF-8 bytes。rubric 只能是 number、boolean 或 enum，不能在运行时增加。

### ArtifactDefinition

Artifact 保存不适合查询的复杂材料：

```ts
import { defineArtifact } from "niceeval/capture";

export const qualityRows = defineArtifact({
  id: "com.example.quality-rows",
  mediaTypes: ["application/json", "text/csv"],
});
```

```ts
interface ArtifactDefinitionOptions {
  readonly id: string;
  readonly mediaTypes: readonly string[];
  readonly maxItems?: number;
}

declare function defineArtifact(
  options: ArtifactDefinitionOptions,
): ArtifactDefinition;
```

`maxItems` 默认为 64，上限为 256。Analysis 只能读取 Artifact identity、media type 与 refs；Artifact 内容不能参与过滤、分组
或聚合。需要比较的值必须在 Capture 时同时写成 Metric 或 Score。

### Definition identity 与演进

平台随每条事实保存 canonical definition snapshot 与 fingerprint。读取时，import 的 definition 必须完全相同，或满足平台内建
的单调兼容规则。

| 改动 | 处理方式 |
|---|---|
| 增加 optional label 或 optional rubric | 保持 ID；旧事实形成显式 missing |
| 给既有 enum 增加 member | 保持 ID |
| 改显示名、格式、颜色或 catalog alias | 只改 Analysis / Report；alias 不参与 identity |
| 改名、删除、值类型、unit、granularity、bounds 含义或事实语义 | 发布新 ID |

跨 ID 的 convert、union 或 side-by-side comparison 由 Analysis 显式声明。平台不会迁移或重新解释旧事实。

## Producer identity

Capture token 把 definition 与 producer behavior 分开：

```ts
interface ProducerIdentityInput<Config extends CanonicalPlainData> {
  readonly id: string;
  readonly behaviorVersion: string;
  readonly config: Config;
}
```

平台规范化 `config` 并保存 fingerprint。它只接受 plain data，不接受 callback、Effect Layer、class instance、secret value 或其它
executable capability。

事实 identity 回答「这是什么」；Producer identity 回答「谁用哪一种行为产生」。领域 `source` label 不能替代 Producer
identity。Analysis 必须要求同 producer、按 producer 分组，或显式声明跨 producer 可比。

## Capture obligation

### MetricCapture

```ts
import { defineMetricCapture } from "niceeval/capture";

export const energyCapture = defineMetricCapture({
  metric: gpuEnergyMetric,
  producer: {
    id: "com.example.nvml-meter",
    behaviorVersion: "2",
    config: { sampling: "attempt-boundary" },
  },
  required: false,
  expectedCoordinates: [
    { source: "nvml", device: "gpu-0" },
  ],
});
```

```ts
interface MetricCaptureOptions<Metric extends MetricDefinition> {
  readonly metric: Metric;
  readonly producer: ProducerIdentityInput<CanonicalPlainData>;
  readonly required: boolean;
  readonly expectedCoordinates?: readonly MetricCoordinate<Metric>[];
}

declare function defineMetricCapture<Metric extends MetricDefinition>(
  options: MetricCaptureOptions<Metric>,
): MetricCapture<Metric>;
```

`expectedCoordinates` 存在时，每个 coordinate 必须恰有一个 cell result。缺少、多出或重复 coordinate 都是 producer contract
violation。省略该字段时，实际 cells 只说明观察到的集合；平台不能声称知道缺少了哪个设备。

### ScoreCapture 与 ArtifactCapture

```ts
const qualityCapture = defineScoreCapture({
  score: dataQualityScore,
  producer: {
    id: "com.example.sql-check",
    behaviorVersion: "3",
    config: { queryVersion: "2026-08-13" },
  },
  required: true,
});

const rowsCapture = defineArtifactCapture({
  artifact: qualityRows,
  producer: {
    id: "com.example.sql-check",
    behaviorVersion: "3",
    config: { queryVersion: "2026-08-13" },
  },
  required: false,
});
```

三种 token 都是纯声明。它们不打开 Attempt、不写 Record，也不能跨 Eval definition 使用。

### 在 Eval 中注册与封口

高级 Eval 作者可以直接注册 token：

```ts
export default defineEval({
  captures: [energyCapture],

  async test(t) {
    const measurement = await measureGpuEnergy();

    await t.metric(energyCapture).seal({
      state: "available",
      cells: [{
        labels: { source: "nvml", device: "gpu-0" },
        value: measurement.joules,
        uncertainty: { absolute: measurement.uncertaintyJoules },
      }],
    });
  },
});
```

普通 Eval 作者应选择封装过 token 与 lifecycle 的领域 Plugin。调用点没有 `record()`、schema、owner 或 converter。

### Metric seal

```ts
type MetricCellResult<Metric extends MetricDefinition> =
  | {
      readonly state: "available";
      readonly labels: MetricCoordinate<Metric>;
      readonly value: number;
      readonly uncertainty?: { readonly absolute: number };
      readonly evidence?: readonly EvidenceRef[];
    }
  | {
      readonly state: "empty" | "unavailable" | "failed";
      readonly labels: MetricCoordinate<Metric>;
      readonly reason: CaptureReason;
      readonly evidence?: readonly EvidenceRef[];
    };

type MetricSeal<Metric extends MetricDefinition> =
  | {
      readonly state: "available";
      readonly cells: readonly MetricCellResult<Metric>[];
    }
  | {
      readonly state: "empty" | "unavailable" | "failed";
      readonly reason: CaptureReason;
      readonly evidence?: readonly EvidenceRef[];
    };
```

`available` cells 非空，value 必须 finite，absolute uncertainty 必须 finite 且不小于零。coordinate 唯一；Metric 没有
timestamp、step、顺序或嵌套 payload。

### Score seal

```ts
type ScoreSeal<Score extends ScoreDefinition> =
  | {
      readonly state: "available";
      readonly rubrics: ScoreRubricResults<Score>;
    }
  | {
      readonly state: "empty" | "unavailable" | "failed";
      readonly reason: CaptureReason;
      readonly evidence?: readonly EvidenceRef[];
    };
```

required rubric 必须恰有一个 `available | empty | unavailable | failed` result；optional rubric 可以 absent。一次 evaluator
invocation 原子封口整个 bundle。自由 explanation 和复杂材料进入 Evidence / Artifact，并由 exact refs 连接。

### Artifact seal

```ts
type ArtifactItem =
  | {
      readonly name: string;
      readonly mediaType: string;
      readonly content: Uint8Array | string | CanonicalPlainData;
    }
  | {
      readonly name: string;
      readonly mediaType: string;
      readonly evidence: EvidenceRef;
    };

type ArtifactSeal =
  | {
      readonly state: "available";
      readonly items: readonly ArtifactItem[];
    }
  | {
      readonly state: "empty" | "unavailable" | "failed";
      readonly reason: CaptureReason;
    };
```

host 负责把 content 放入自有 blob closure；作者不能选择 Record path 或 blob identity。`evidence` 只接受已经 sealed、media type
相容且属于本次 Attempt 的 exact ref，使 Artifact 可以复用同一 blob 而不复制 content。

### Total producer obligation

一个注册 token 对每个实际 Attempt 必须恰好封口一次：

| 结果 | 可观察语义 |
|---|---|
| `available(0)` | 合法零值 |
| `empty` | producer 成功结束，但领域上没有值 |
| `unavailable` | 当前宿主运行条件无法取得值 |
| `failed` | producer 执行失败并完成失败封口 |
| 未封口 | producer contract violation |

重复、foreign 或 Attempt 关闭后的 late seal 同样是 contract violation，并令 Attempt 失败。`required: true` 的 explicit
`failed` 令 Attempt 失败；`required: false` 允许 Attempt 结束，但 Analysis 必须保留失败状态。

## Analysis fields

### Metric Measure

```ts
import {
  allLogicalSlots,
  mean,
  metricMeasure,
  partial,
  requireSameProducer,
  sum,
} from "niceeval/analysis";

export const gpuEnergyJoules = metricMeasure(gpuEnergyMetric, {
  producers: requireSameProducer(),
  withinAttempt: sum(),
  withinEval: mean(),
  acrossEvals: mean(),
  denominator: allLogicalSlots(),
  missing: partial(),
});

export const gpuEnergySource = gpuEnergyMetric.labels.source;
```

多 cell Metric 必须声明完整三段 reduction：

```text
withinAttempt → withinEval → acrossEvals
```

`withinAttempt` 先把一个 Attempt 的 coordinate cells 折成值；`withinEval` 处理同一 logical slot 的 Attempt policy；
`acrossEvals` 才跨 logical slots 聚合。

Producer policy 是穷尽联合：

```ts
type ProducerPolicy =
  | ReturnType<typeof requireSameProducer>
  | ReturnType<typeof groupByProducer>
  | ReturnType<typeof comparableProducers>;
```

`comparableProducers({ producers, reason })` 必须列出允许混合的 producer identities 与可审计理由。

### Score Measure

```ts
export const correctness = scoreMeasure(
  dataQualityScore.rubrics.correctness,
  {
    producers: requireSameProducer(),
    withinEval: mean(),
    acrossEvals: mean(),
    denominator: allLogicalSlots(),
    missing: partial(),
  },
);
```

Score rubric 已在一次 Attempt 内原子封口，因此不需要 `withinAttempt` cell reducer。

### Custom Dimension、Measure 与 relation

领域包可以组合已经发布的 fields，但不能在 callback 中读取 Record：

```ts
export const energyEfficiency = defineMeasure({
  id: "com.example.energy-efficiency",
  population: logicalSlots,
  inputs: {
    energy: gpuEnergyJoules,
    quality: passRate,
  },
  denominator: allLogicalSlots(),
  calculate: ({ energy, quality }) =>
    metricRatio({ numerator: quality, denominator: energy }),
});
```

```ts
declare function defineDimension<Population, Value>(
  options: DimensionOptions<Population, Value>,
): Dimension<Population, Value>;

declare function defineMeasure<Population, Value>(
  options: MeasureOptions<Population, Value>,
): Measure<Population, Value>;

declare function defineAnalysisRelation<From, To>(
  options: AnalysisRelationOptions<From, To>,
): AnalysisRelation<From, To>;
```

跨 population 必须先定义具名 `AnalysisRelation`，再在目标 population 上发布新 field。Report 不 join、不按数值容差寻找成员，
也不自动改变 population。

### MetricValue

Analysis Measure 的结果不是未包装的 number：

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

合法零值、cell missing、bundle failure 与 producer contract violation 不能合并。`observed` 与 `denominator` 使用 Analysis
population，不使用 transport row count。

### Standalone analyze

```ts
const rows = await analyze(sample, {
  by: { condition, source: gpuEnergySource },
  values: { passRate, gpuEnergyJoules },
});
```

`analyze()` 与 Report 的 `aggregate()` 使用同一个 field executor。它们都绑定调用时的 frozen Sample，不能打开另一个 root。

## ReportSample

Page 与 component callback 获得受限 `ReportSample`：

```ts
interface ReportSample {
  readonly identity: ReportSampleIdentity;
  readonly selection: ReportSelectionSummary;
  readonly problems: readonly ReportSampleProblem[];
  readonly coverage: ReportSampleCoverage;
}
```

它不能枚举 raw Run / Attempt，不能 `.filter()` 改 population，不能读取官方或第三方 raw facts，也不能调用 projection。需要
Attempt 明细、成员表或新 population 时，Analysis package 必须先发布 identity Dimension、Measure 或具名 relation。

## aggregate

```ts
declare function aggregate<By extends Dimensions, Values extends Measures>(
  sample: ReportSample,
  options: {
    readonly by: By;
    readonly values: Values;
  },
): Promise<readonly AggregateRow<By, Values>[]>;
```

```tsx
const rows = await aggregate(sample, {
  by: {
    condition,
    source: gpuEnergySource,
  },
  values: {
    passRate,
    energy: gpuEnergyJoules,
  },
});
```

每行包含完整 grouping coordinate、稳定 opaque row key，以及每个 Measure 的 `MetricValue`。callback 可以依据 closed rows
选择后续呈现或调用另一组 `aggregate()`。它可以做 display-only sort、limit 或 filter，但不能用处理后的数组重新聚合、重算
`MetricValue` 或缩小 denominator。

## Report components

### 自定义复合组件

```tsx
export const EnergyLeaderboard = defineComponent(
  async (_props, { sample }) => {
    const rows = await aggregate(sample, {
      by: { condition, source: gpuEnergySource },
      values: { passRate, energy: gpuEnergyJoules },
    });

    return (
      <Bars
        points={rows}
        x="condition"
        y="energy"
        color="source"
        sort={{ field: "energy", direction: "asc" }}
        layout="horizontal"
      />
    );
  },
);
```

`defineComponent()` callback 在一个 Page instance 中最多执行一次。它只能返回 NiceEval semantic primitives 或其它复合组件。
普通 Report package 不能注册新的 host primitive；新增 primitive 必须同时定义 terminal、Web、static 与无 JavaScript 降级语义。

### 内建 semantic primitives

| primitive | 数据属性 | 主要呈现责任 |
|---|---|---|
| `Summary` | `values` | 少量具名 MetricValue |
| `Table` | `rows`、columns、sort、limit | 精确值、coverage、issues 与 refs |
| `Bars` | `points`、x、y、color、sort、layout | 分类比较与 text bars |
| `Scatter` | `points`、x、y、color、point | 两个 Measure 的关系与 evidence target |
| `Line` | `points`、x、y、color | 有明确有序 Dimension 的序列 |
| `EvidencePreview` | `refs`、`maxItems` | 有界展示 JSON、CSV、文本、图片或下载项；不执行分析 |
| `Callout` | tone、title、content | 具名问题、限制或说明 |
| `Stack` / `Grid` | children | 布局，不改变数据 |

组件按 typed field key 取值，不能接收两个需要调用者保持长度相等的平行数组。Measure 的 unit、format、better、coverage 与 refs
随 row 进入组件；作者不手动乘 100、拼单位或复制 denominator。

`EvidencePreview` 由 host 在 semantic tree 闭合前按 exact refs 读取并验证内容。callback 只能选择 refs 与显示上限，不能取得内容、按内容过滤或把
内容送回 `aggregate()`。JSON / CSV 的 terminal face 是有界表格，Web face 可以增强交互，static face 包含同一内容 closure；三种
face 都保留 media type、截断状态与下载入口。

## Page 与 Report

```tsx
const overview = definePage({
  id: "overview",
  route: "/",
  title: "Overview",

  render: async ({ sample }) => {
    const [summary] = await aggregate(sample, {
      by: {},
      values: { passRate, duration },
    });

    return (
      <Stack>
        <Summary values={{ passRate: summary.passRate, duration: summary.duration }} />
        <EnergyLeaderboard />
      </Stack>
    );
  },
});

export default defineReport({
  id: "memorybench",
  pages: [overview, attemptPageFamily],
});
```

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

interface ReportDefinition {
  readonly id: string;
  readonly pages: readonly (PageDefinition | PageFamilyDefinition)[];
}
```

PageFamily 的 keys 必须来自 Analysis 发布的 stable identity Dimension。route target 绑定 family object identity 与 row key，不使用
数组 index 或显示 label。Evidence refs 只有在唯一 target 存在时形成链接；多个候选 target 不任选一个。

`by: {}` 对一个非空或全 missing population 都返回恰好一行；各 Measure 用自己的 state、observed 与 denominator 表达可用性。
因此摘要页不需要把“没有可用数值”变成空数组分支。

## Report execution guarantees

普通 data-dependent JavaScript callback、callback 前整份 Report 依赖编译、只执行请求 Page 三者不能同时成立。本 API 保留第一
和第三项，并采用运行时局部闭包：

1. `aggregate()` 第一次调用时编译该 field DAG；cycle、population mismatch 与 identity collision 在事实读取前拒绝。
2. 每个 Page / component instance 的 callback 在一次 `ReportExecution` 中最多执行一次，不 dry-run。
3. 同一次 execution 按 frozen Sample identity 与 nominal field/dependency identity memoize；不同 Page 可以复用计算。
4. 只执行请求的 Page；Page failure 不使其它 Page 失去可执行性。
5. static export 在一次 execution 中枚举目标 Page instances，因此可以共享 field cache。
6. execution 结束后只留下 closed semantic tree；reader、Sample handle、Promise 与 callback 不进入 renderer。
7. terminal、Web 与 static face 只消费同一棵 closed tree。

硬保证只到同一次 execution。普通 JavaScript callback 的跨 execution 纯度是 trusted-author contract，不是 sandbox 保证。
provenance 保存 Report module fingerprint、Sample identity、selection 与 host version；不同 CLI / view execution 不承诺共享 cache
或逐字节相同。相同 closed tree 与 renderer version 必须产生稳定静态输出。

## Errors

| code | 作用域 | 语义 |
|---|---|---|
| `capture-definition-invalid` | definition load | ID、label、rubric、bounds 或上限不合法 |
| `capture-definition-incompatible` | read / Analysis | import definition 不能解释历史 snapshot |
| `capture-obligation-violation` | Attempt | 漏封、重复、foreign、late 或 coordinate 不完整 |
| `capture-producer-failed` | Attempt / Analysis | producer 显式失败；是否令 Attempt 失败由 `required` 决定 |
| `analysis-population-mismatch` | Analysis call | fields 不属于同一 population，且没有具名 relation |
| `analysis-producer-incompatible` | Analysis call | Measure 没有合法 producer policy |
| `analysis-cycle` | Analysis call | 本次 field DAG 有 cycle |
| `report-page-failed` | Page | callback 或 component 失败；其它 Page 保持隔离 |
| `migration-required` | read | 平台固定信封需要显式迁移 |
| `migration-unsupported` | maintenance | 无法无损保留 unknown envelope 或 blob closure |

每个错误必须给出 definition / producer / field / Page identity、失败阶段与下一步。Capture error 不伪装成 missing；Report error 不
改写 Analysis value。
