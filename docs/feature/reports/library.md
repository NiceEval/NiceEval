# 报告作者 API —— Library

本篇给出普通值转换模型的完整公开形状。
总览见 [README](README.md)，运行边界见 [Architecture](architecture.md)。

## `defineReport()` 保留静态 page 边界

单页报告直接传函数。
这个函数在装载时不会执行，而是成为 id 为 `report` 的惰性 sample page：

```ts
type PageRender<Input> = (
  input: Input,
) => ReportNode | Promise<ReportNode>;

function defineReport(
  render: PageRender<Sample>,
): ReportDefinition;
```

```tsx
export default defineReport((sample) => (
  <Col>
    <AttemptList attempts={sample.attempts} />
  </Col>
));
```

多页报告静态声明 pages。
函数只放在每页的 `render` 与 `load` 字段，不用先执行整份报告才能知道页清单。
page 只有一种形状，核心不区分实体种类：

```ts
interface PageParams<P> {
  encode(params: P): string;
  decode(key: string): P;
  enumerate(base: Sample): Iterable<P>;
}

interface PageLoadContext {
  evidence(locator: AttemptLocator): Promise<AttemptEvidence>;
}

interface PageDefinition<P = void, I = Sample> {
  id: string;
  title: LocalizedText;
  navigation?: boolean;
  params?: PageParams<P>;
  load?: (
    base: Sample,
    params: P,
    ctx: PageLoadContext,
  ) => I | Promise<I>;
  render: PageRender<I>;
}
```

`load` 回答「这页的输入从哪来」：省略时输入就是宿主选好的 Sample。
`params` 把一页声明成参数化页：同一张页按参数产生多个实例，每个实例可被[目标](#目标与下钻)寻址。
`encode` / `decode` 定义参数与 URL key 的互转，`enumerate` 列出有效根内全部合法参数，静态导出据此物化。
attempt 详情、experiment 详情都是这样的参数化页，见[参数化页](#参数化页attempt-与-experiment-详情)；核心、路由与宿主对它们没有专门分支。

```ts
interface ReportOptions {
  title?: LocalizedText;
  theme?: ThemeDefinition;
  dimensionPins?: DimensionPins;
  head?: HeadTag[];
  pages: readonly [
    PageDefinition,
    ...PageDefinition[],
  ];
}

function defineReport(
  options: ReportOptions,
): ReportDefinition;
```

外壳只装宿主机器必须在 page render 之外消费的声明。
四个字段各有一个组件与普通函数够不着的宿主落点，因此必须由官方提供：

| 字段 | 宿主落点 |
|---|---|
| `title` | 浏览器 `<title>` 与 show 页索引标题——文档单例 |
| `theme` | 与报告平行的主题装载链，`--theme` 可整份替换 |
| `dimensionPins` | 页级槽位分配在装载期读固定声明，不执行其它 page |
| `head` | 注入文档 `<head>`——报告树没有 HTML intrinsic |

四个字段的类型、白名单与本地路径纪律见 [外壳契约](library/shell.md)。
单页函数缩写没有外壳；需要外壳字段时使用对象形态。

页脚、页头链接这类跨页内容不是外壳字段，写法见[跨页内容是普通组合](#跨页内容是普通组合)。
组件的脚本与样式随组件声明，机制见 [Architecture · 组件自带资产](architecture.md#组件自带资产)；站点级第三方注入（埋点、字体、SEO）声明在 `head`。

```tsx
export default defineReport({
  title: "Security evals",
  pages: [
    {
      id: "overview",
      title: "Overview",
      render: async (sample) => (
        <Col>
          {await overview(sample)}
        </Col>
      ),
    },
    {
      id: "failures",
      title: "Failures",
      render: (sample) => (
        <Col>
          {failures(sample)}
        </Col>
      ),
    },
    standardAttemptPage,
  ],
});
```

`pages` 是非空有序数组，`id` 是稳定 page id，数组顺序就是导航顺序。
装载期规则逐条可校验：`id` 不得重复；声明 `params` 的页必须同时声明 `load` 且 `navigation: false`——导航项给不出参数。
这些条件、外壳字段和 page id 在装载期校验，不运行 `render` 或 `load`。

宿主只执行被请求的 page render。
一次 page 实例产生的同一份值树交给 text 与 web renderer，两个 renderer 不会分别运行该 page。

## 跨页内容是普通组合

页脚、页头链接、团队署名这类每页都出现的内容不是外壳字段。
render 是函数，跨页复用就是包一层：

```tsx
import { footerNote } from "./chrome";

const chrome =
  (render: PageRender<Sample>): PageRender<Sample> =>
  async (sample) => (
    <Stack>
      {await render(sample)}
      {footerNote}
    </Stack>
  );

export default defineReport({
  pages: [
    { id: "overview", title: "Overview", render: chrome(overview) },
    { id: "failures", title: "Failures", render: chrome(failures) },
    standardAttemptPage,
  ],
});
```

`footerNote` 是具名导出的普通 ReportNode。
宿主没有页脚槽，也不渲染任何保留内容；内建 standard 报告的页脚同样是它自己 pages 里的普通内容。

## 输入就是 Sample

宿主先完成 `--record`、`--exp`、Eval 位置参数与 `--fresh` 的选择，再把同一份 Sample 传给被请求的 sample page render。

作者继续使用 Sample 已有转换：

```ts
const security = sample.scope({ evals: "security/" });

const failures = security.filter((attempt) =>
  attempt.result.verdict === "failed" ||
  attempt.result.verdict === "errored"
);
```

`scope()` 改变总体，`filter()` 删除不可信或不适用观测；两者继续维护 `attempts`、`historyAttempts`、coverage 与 issues。

作者只有在不再需要 Sample 语义时才取出数组做普通加工：

```ts
const top50 = failures.attempts
  .toSorted((a, b) =>
    (attemptCostUSD(b.result) ?? 0) -
    (attemptCostUSD(a.result) ?? 0)
  )
  .slice(0, 50);
```

聚合函数收 Sample，不收随手过滤的 `AttemptHandle[]`。
这样覆盖分母、历史口径与去重事实不会在普通数组操作中丢失。

一组图共享范围时，先产生一个具名 Sample 值，再把它交给每次计算：

```ts
const production = sample
  .scope({ experiments: "production/" })
  .filter(isReliableAttempt);

const [quality, cost] = await Promise.all([
  aggregate(production, {
    by: { agent },
    values: { passRate },
  }),
  aggregate(production, {
    by: { model },
    values: { costUSD },
  }),
]);
```

这里 `scope()` 改变比较总体和 coverage 分母，`filter()` 只排除不参与计算的观测。
组件不再接受另一套 `filter` 属性，内建报告也不能在组件内部隐藏过滤；源码中的 `production` 就是两张图共享口径的唯一说明。

## 分组函数与计算函数

`aggregate()` 的 `by` 与 `values` 都接收函数值：

```ts
import {
  agent,
  costUSD,
  experiment,
  passRate,
} from "niceeval/report";
```

分组以题级单元（Experiment × Eval）为单位。
`AggregationSubject` 是一个题级单元的事实视图；coverage 缺口也有自己的单元，没跑到的题因此照常归组、照常进 total：

```ts
interface AggregationSubject {
  readonly experimentId: string;
  readonly evalId: string;
  /** 该 Experiment 的锚点 Run；不暴露 attempts。 */
  readonly run: Run;
}

const experiment:
  (subject: AggregationSubject) => string;

const agent:
  (subject: AggregationSubject) => string;

const attemptCostUSD:
  (result: EvalResult) => number | null;
```

官方分组的事实来源固定：

| 分组 | 读取 |
|---|---|
| `experiment` | `subject.experimentId` |
| `agent` / `model` | Run 顶层 `subject.run.agent` / `subject.run.model` |
| flags / labels / 运行配置 | `subject.run.experiment` |

分组函数是普通同步函数。
官方函数与用户函数没有不同的类型或执行入口。
分组函数拿不到 AttemptHandle：分组因此不可能把同一道题的 attempts 切进两个组，题级折叠的边界由类型保护。
零 attempt 的 Eval 仍有确定的锚点 Run，因此「按 agent 分到哪一行」有唯一答案。

计算函数由公开的 `rollup()` 产生。
它描述“一条 Attempt 怎样取值”，并让组合器负责题内与跨题聚合。
Reducer 也是函数值，不使用 `"mean"` 之类的字符串 DSL：

```ts
interface Reducer {
  (values: readonly number[]): number | null;
  readonly name: string;
}

const mean: Reducer;
const sum: Reducer;
const min: Reducer;
const max: Reducer;

function percentile(p: number): Reducer;

interface RollupOptions {
  withinEval?: Reducer;
  acrossEvals?: Reducer;
  unit?: string;
  better?: "higher" | "lower";
  bounds?: {
    min?: number;
    max?: number;
  };
}

function rollup(
  value: (
    attempt: AttemptHandle,
  ) => number | null | Promise<number | null>,
  options?: RollupOptions,
): Calculation;
```

官方通过率使用这份公开函数：

```ts
export const passRate = rollup(
  (attempt) => {
    switch (attempt.result.verdict) {
      case "passed":
        return 1;
      case "failed":
      case "errored":
        return 0;
      case "skipped":
        return null;
    }
  },
  {
    withinEval: mean,
    acrossEvals: mean,
    unit: "%",
    better: "higher",
    bounds: {
      min: 0,
      max: 1,
    },
  },
);
```

用户计算完全相同：

```ts
export const changedLines = rollup(
  async (attempt) => {
    if (attempt.result.verdict !== "passed") {
      return null;
    }

    const diff = await attempt.diff();
    if (!diff) {
      return null;
    }

    return Object.keys(diff.files)
      .reduce(
        (sum, path) =>
          sum + (diff.get(path) ?? "").split("\n").length,
        0,
      );
  },
  {
    withinEval: min,
    acrossEvals: mean,
    unit: "lines",
    better: "lower",
  },
);
```

省略任一级时默认使用 `mean`。
`rollup()` 先排除该级的 `null`，再调用 Reducer；空集合保持 `null`，不会被 `sum` 伪装成零。

### samples / total 的口径

`rollup()` 产物的 samples、total 与 refs 用一组算例锁定。
范围内有三道 Eval：`a` 有三个 attempt，题内值 `[1, 0, null]`；`b` 有一个 attempt，题内值 `[1]`；`c` 在题集内但一个 attempt 都没跑。

| withinEval / acrossEvals | 题级值 | value | samples / total |
|---|---|---|---|
| `mean` / `mean` | `a: 0.5`、`b: 1` | `0.75` | `2 / 3` |
| `min` / `max` | `a: 0`、`b: 1` | `1` | `2 / 3` |
| 题内值全为 `null` | 无 | `null` | `0 / 3` |

三行的 basis 都是 `"eval"`，attempt 从不是 samples 的计数单位。
refs 三行相同：`a` 的三个 attempt 加 `b` 的一个，共四个 locator。
`a` 里返回 `null` 的 attempt 不产生题内值，但它被检查过，留在 refs 里供下钻解释缺数。
`c` 没有 attempt，没有 locator，只把 total 从 2 抬到 3——coverage 缺口进分母，不进终值。

`percentile(p)` 接受闭区间 `[0, 1]`。
对升序数组使用 `h = (n - 1) × p`，再在 `floor(h)` 与 `ceil(h)` 对应值之间线性插值；因此 `percentile(0.5)` 是确定的中位数，且相同输入跨平台产生相同结果：

```ts
export const p95DurationMs = rollup(
  attemptDurationMs,
  {
    withinEval: percentile(0.95),
    acrossEvals: mean,
    unit: "ms",
    better: "lower",
  },
);
```

这里明确表示“每题先算 p95，再让每道题等权平均”，不等价于把全部 Attempt 混在一起算 p95。

公共层不提供无主语的 `count` 或 `countDistinct` reducer。
计数必须说明数什么，并以具名 Calculation 表达：

```ts
export const observedAttemptCount = rollup(
  () => 1,
  {
    withinEval: sum,
    acrossEvals: sum,
    unit: "attempts",
  },
);
```

它明确数参与计算的有效 Attempt。
若要数 coverage 中的 Eval、Run 或 Experiment，使用对应事实写具名普通函数；不能假装这些实体都是数值数组中的“行”。
需要 distinct 时，报告旁函数必须声明 identity 与跨 Eval 去重范围；不能把各题 distinct count 相加后称作全局 distinct count。

`passRate` 与 `changedLines` 都是 Calculation 函数值，可以放进同一个 `aggregate()`：

```tsx
const performance = await aggregate(sample, {
  by: { agent },
  values: {
    passRate,
    costUSD,
    changedLines,
  },
});
```

Calculation 从一个保留题级边界与 coverage 的聚合组产生 MetricValue：

```ts
interface MetricValue {
  value: number | null;
  unit?: string;
  format?: MetricFormat;
  better?: "higher" | "lower";
  bounds?: {
    min?: number;
    max?: number;
  };
  samples: number;
  total: number;
  basis: "attempt" | "eval" | "run" | "pair";
  refs: readonly AttemptLocator[];
}
```

作者不直接构造聚合组。
Calculation 只作为 `aggregate()` 的 value 传入。
`basis` 命名 samples / total 的计数单位，终值就是在这个粒度上得出的统计量；`refs` 与 basis 无关，恒为 Attempt locator——它是证据链，不承担分母。

`rollup()` 的产物固定 `basis: "eval"`，计数单位是题级单元：samples 数至少有一个非 null 题内值的单元，total 数组内全部单元，含一个 attempt 都没跑到的 coverage 缺口。
用户不手工拼 MetricValue。
MetricValue 不预生成本地化 display；text 与 web renderer 使用同一份 `value + format` 按当前 locale 格式化。

## `aggregate()`：Sample 转结果行

签名：

```ts
function aggregate<
  const Groups extends GroupFunctions,
  const Values extends CalculationFunctions,
>(
  sample: Sample,
  options: {
    by: Groups;
    values: Values;
  },
): Promise<readonly AggregateRow<Groups, Values>[]>;
```

使用对象键决定结果字段名：

```tsx
const performance = await aggregate(sample, {
  by: {
    experiment,
    agent,
  },
  values: {
    passRate,
    costUSD,
  },
});
```

推导结果：

```ts
readonly {
  experiment: string;
  agent: string;
  passRate: MetricValue;
  costUSD: MetricValue;
  refs: readonly AttemptLocator[];
}[];
```

这是普通只读数组。
作者可以继续使用 JavaScript：

```ts
const ranked = performance.toSorted(
  (a, b) =>
    (b.passRate.value ?? -Infinity) -
    (a.passRate.value ?? -Infinity),
);
```

`aggregate()` 内部负责：

- 按 `by` 把题级单元归组，coverage 缺口单元照常归组。
- 同一 Experiment × Eval 的 attempts 先折成题级值。
- 题级值再跨单元折成终值。
- 预期缺数据返回 `value: null`。
- coverage 缺口不进终值、不冒充零，但计入 total。
- `refs` 覆盖非空与空值 Attempt。
- 相同输入产生确定顺序与字节稳定结果。

AggregateRow 同时是 EvidenceRow。
行级 `refs` 是本行全部 MetricValue refs 的稳定去重并集，用于点击一个图形点时下钻；每个 MetricValue 仍保留自己的精确 refs。

`by` 与 `values` 的键落进同一个行命名空间，`refs` 是行级保留键。
两侧键互斥，且都不得使用 `refs`：`AggregateRow<Groups, Values>` 的泛型在编译期拒绝冲突，无类型 JavaScript 调用在执行期同样拒绝，错误指出冲突键名和它来自 `by` 还是 `values`。

### 自定义分组

作者可以传普通同步函数：

```tsx
const byVendor = await aggregate(sample, {
  by: {
    vendor: (subject) =>
      subject.run.model?.startsWith("gpt-")
        ? "OpenAI"
        : "Anthropic",
  },
  values: {
    passRate,
    costUSD,
  },
});
```

分组函数必须返回字符串，且不能读取时钟、随机数、网络或文件系统。
抛错时错误带分组字段名与出错单元的 Experiment × Eval 坐标。

`values` 接受任何 `rollup()` 产出的 Calculation。
官方报告 import 的 `passRate`、`costUSD` 与用户报告使用的是同一份公开导出，没有内部快捷路径。
内建 preset 也不能偷偷附加只对官方生效的 Attempt 过滤；任何排除规则必须在传给 `aggregate()` 的 Sample 上可见。

### 结果粒度不能倒流

`aggregate()` 只接受 Sample。
它返回的 AggregateRow 是完成计算的普通结果，可以排序、截断、join 和显示，但不能再次传给 `aggregate()`：

```ts
const performance = await aggregate(sample, {
  by: { agent },
  values: { passRate, costUSD },
});

const top = performance
  .toSorted((a, b) =>
    (b.passRate.value ?? -Infinity) -
    (a.passRate.value ?? -Infinity)
  )
  .slice(0, 10);

aggregate(performance, options); // 类型错误：AggregateRow[] 不是 Sample
```

需要增加读数时，回到同一份 Sample，把 Calculation 加进原来的 `values`。
这避免对已经跨 Eval 聚合的结果再次平均。

## 非 rollup 分析也必须携带证据

成对差异和跨 Run 稳定性不能强行放入“每 Attempt 一个标量，再做两级 reducer”的 `rollup()`。
它们可以留在报告旁，但不能返回无证据的普通数字。

公共层提供两个低层结果构造器，不开放内部 AggregationGroup：

```ts
function metricValue(options: {
  value: number | null;
  samples: number;
  total: number;
  basis: "attempt" | "eval" | "run" | "pair";
  evidence: readonly (AttemptHandle | AttemptLocator)[];
  unit?: string;
  format?: MetricFormat;
  better?: "higher" | "lower";
  bounds?: {
    min?: number;
    max?: number;
  };
}): MetricValue;

function evidenceRow<const Fields extends object>(
  fields: Fields,
): Fields & EvidenceRow;

interface EvidenceRow {
  readonly refs: readonly AttemptLocator[];
}
```

`metricValue()` 要求算法明确 samples、total 及其 basis，验证 `0 <= samples <= total`，并从 evidence 自动生成稳定去重的 refs。
evidence 同时接受 AttemptHandle 与 AttemptLocator：直接读 Attempt 的算法传 handle；从已聚合 MetricValue 派生新读数的算法把上游 refs 作为 evidence 传入。
成绩单总分合并各题格 refs 就是后一条路径。

缺失的配对一侧没有 locator，但仍能通过 `basis: "pair"`、`samples: 0, total: 1` 表达固定分母；已有的另一侧 Attempt 仍进入 evidence，供下钻解释缺失。

`evidenceRow()` 要求至少有一个 MetricValue 字段，并把所有 MetricValue refs 合并成行级 refs。

EvidenceRow 没有 symbol 品牌。
它经过 JSON fixture 或 React props 往返后仍按 `refs` 与各 MetricValue 的可序列化结构校验，不需要再水化。

例如成对比较函数显式决定 baseline、candidate、配对键和缺失策略，最后只能通过这两个构造器交出图表结果：

```ts
async function pairedDelta(
  sample: Sample,
  options: DeltaOptions,
): Promise<readonly DeltaPoint[]> {
  const pairs = pairAttempts(sample, options);

  return pairs.map((pair) => {
    const evidence = [pair.baseline, pair.candidate]
      .filter((attempt): attempt is AttemptHandle => Boolean(attempt));

    return evidenceRow({
      eval: pair.evalId,
      delta: metricValue({
        value: pair.delta,
        samples: pair.isComparable ? 1 : 0,
        total: 1,
        basis: "pair",
        evidence,
        unit: "%",
        better: "higher",
      }),
    });
  });
}
```

`Scatter`、`Bars`、`Line` 等图表对 Sample 派生读数只接受 EvidenceRow points。
普通 Table 仍可显示实体投影 rows；一旦某个数字声称是从 Sample 推导的读数，就必须是 MetricValue。
因此把领域算法移到报告旁不会把 refs、samples 和 total 降级成作者自觉。

### 并行计算

多个独立结果使用普通 `Promise.all`：

```tsx
const [byAgent, byExperiment] = await Promise.all([
  aggregate(sample, {
    by: { agent },
    values: { passRate, costUSD },
  }),
  aggregate(sample, {
    by: { experiment },
    values: { passRate },
  }),
]);
```

这不是作者必须学习的框架管线。
它只是异步 TypeScript 的普通组合。

### 检查与导出结果

`aggregate()` 返回普通可序列化值，因此不需要 `inspect()`、查询 id 或“打开数据源”协议：

```ts
const performance = await aggregate(sample, {
  by: { agent },
  values: { passRate, costUSD },
});

console.dir(performance, { depth: null });
const fixture = JSON.stringify(performance, null, 2);
```

同一份值可以成为单元测试 fixture、写入 JSON，或同时交给图和表。
每个 MetricValue 自带 value、format、samples、total、basis 与 refs；排查某个点时不必从图形配置反推一条新查询。

## 实体转换

实体投影是立即执行的普通函数。
函数名用 `to*` 表明输入值会立刻转换成结果值。

```ts
const rows = toAttemptRows(attempts);
const rows = toExperimentRows(sample);
const rows = toEvalRows(sample);
const nodes = await toTraceNodes(sample);
const items = await toSummaryItems(sample);
const items = toSampleNotices(sample);
```

每个函数返回组件所需的精确值，不返回统一 Content：

```ts
function toAttemptRows(
  attempts: readonly AttemptHandle[],
): readonly AttemptRow[];

function toExperimentRows(
  sample: Sample,
): readonly ExperimentRow[];

function toTraceNodes(
  sample: Sample,
): Promise<readonly WaterfallNode[]>;
```

普通数组加工可以发生在转换前或转换后：

```tsx
const attempts = sample.attempts
  .filter((attempt) =>
    attempt.result.verdict !== "passed"
  )
  .toSorted((a, b) =>
    (attemptCostUSD(b.result) ?? 0) -
    (attemptCostUSD(a.result) ?? 0)
  )
  .slice(0, 50);

const rows = toAttemptRows(attempts);

return <Table rows={rows} />;
```

高频实体显示提供薄组合组件：

```tsx
<AttemptList attempts={attempts} />
<ExperimentTable input={sample} />
```

这些组件等价于官方转换加通用组件，不建立第二条计算口径：

```tsx
function AttemptList({ attempts }: AttemptListProps) {
  return <Table rows={toAttemptRows(attempts)} />;
}
```

默认实验比较由两个独立组合组件承担：

```tsx
<ExperimentScatter input={sample} />
<ExperimentTable input={sample} />
```

前者显示成本 × 主读数散点；后者显示 Experiment → Eval → Attempt 的层级详情。

## 组件接具体值

每个组件使用能说明角色的属性：

| 组件 | 主要属性 |
|---|---|
| `Table` | `rows` |
| `Scatter` | `points` |
| `Line`、`Bars`、`Area` | `points` |
| `Stat` | `value` |
| `Grid` | `items` |
| `Callouts` | `items` |
| `Conversation` | `turns` |
| `Waterfall` | `nodes` |
| `SourceView` | `source` |
| `DiffView` | `files` |
| `AttemptDetails` | `attempt` |
| `ExperimentDetails` | `input` |

不存在适用于所有组件的 `data` 属性。

### `Table`

聚合行可直接显示：

```tsx
<Table rows={performance} />
```

覆盖列时使用普通数组：

```tsx
<Table
  rows={performance}
  columns={[
    "agent",
    {
      field: "costUSD",
      label: {
        en: "Spend",
        "zh-CN": "花费",
      },
    },
    "passRate",
  ]}
/>
```

类型：

```ts
type Column<Row> =
  | keyof Row
  | {
      field: keyof Row;
      label?: LocalizedText;
      hidden?: boolean;
    };

interface TableProps<Row extends object> {
  rows: readonly Row[];
  columns?: readonly Column<Row>[];
  searchable?: boolean;
}
```

`Table` 根据值类型渲染字符串、数字、LocalizedText 与 MetricValue。
遇到不支持的对象类型时装载失败，并指向字段与行。

### 图表

图表接收带行级 refs 的普通结果数组：

```tsx
<Scatter
  points={performance}
  x="costUSD"
  y="passRate"
  color="agent"
  point="experiment"
/>

<Line
  points={trendPoints}
  x="run"
  y="passRate"
  color="agent"
/>

<Bars
  points={performance}
  x="agent"
  y="passRate"
  sort={{ field: "passRate", direction: "desc" }}
  layout="horizontal"
/>
```

图表的纯外部数据入口是显式的 `external` 声明：

```ts
type ExternalScalar = string | number | boolean | null;
type ExternalPoint = Readonly<Record<string, ExternalScalar>>;

interface ScatterProps<Row extends EvidenceRow> {
  points: readonly Row[];
  x: keyof Row;
  y: keyof Row;
  color?: keyof Row;
  point?: keyof Row;
  pointTarget?: (row: Row) => ReportTarget | undefined;
}

interface ExternalScatterProps<Row extends ExternalPoint> {
  external: true;
  points: readonly Row[];
  x: keyof Row;
  y: keyof Row;
  color?: keyof Row;
}
```

未声明 `external` 的图表只接受 EvidenceRow points：运行时结构校验 refs 与 MetricValue，缺失即报错并指向字段。
`external` 图表只接受 JSON 标量行，没有 MetricValue，也没有 Attempt 下钻。
预算随时间、业务目标线等完全不从 Sample 推导的序列走这条分支。

这条边界承诺四件可执行的事：

- 默认路径在运行时结构校验 refs 与 MetricValue，无证据的行直接报错。
- `external: true` 是对证据契约的显式退出，不是另一种校验。
- NiceEval 不验证 external 行的数据真实来源。
- `external` 这个词在源码与 review 里可搜索。

结构无法区分「真外部数据」与「洗掉证据的 Sample 数字」，把 Sample 派生数字标成 external 因此只受审查约束，与伪造读数同责。

`x`、`y`、`color` 与 `point` 由 points 的行类型推导。
MetricValue 自动提供数值、格式元数据、自然边界与 refs；renderer 按当前 locale 格式化。

一个图形点点开去哪由 `pointTarget` 决定，图表原语只负责把返回的[目标](#目标与下钻)交给宿主换 href。
省略时按行级 refs 走 `targetOfRefs()` 默认规则：恰好一个 ref 才成链，多 refs 不猜。
`pointTarget` 返回 `undefined` 的点是纯图形；`external` 图表没有 refs，也没有 `pointTarget` 属性。

混合图才使用嵌套 series。
`<Chart>` 的 points 是各 series 的默认；一个 series 可以带自己的 points 和 `external` 声明，证据校验按该 series 自己的入口判定。
业务目标线因此能叠在 Sample 派生图上，而不混进证据行：

```tsx
<Chart points={performance}>
  <Bars x="agent" y="costUSD" />
  <Line x="agent" y="passRate" axis="right" />
  <Line external points={budgetTargets} x="agent" y="targetUSD" />
</Chart>
```

## 复用就是普通函数

可复用区块不需要定义新的组件协议：

```tsx
async function qualityCost(sample: Sample): Promise<ReportNode> {
  const points = await aggregate(sample, {
    by: { agent },
    values: { passRate, costUSD },
  });

  return (
    <Stack>
      <Scatter
        points={points}
        x="costUSD"
        y="passRate"
        point="agent"
      />
      <Table rows={points} />
    </Stack>
  );
}
```

报告直接调用：

```tsx
export default defineReport(async (sample) => (
  <Col>
    {await qualityCost(sample)}
  </Col>
));
```

函数可以收 props、Sample 或已计算结果。
它不需要品牌、注册表、context 或特殊 JSX 展开规则。

## 报告参数是工厂函数

报告级自定义参数同样不需要新协议。
组件的参数是 props，报告的参数是普通闭包：导出一个返回 ReportDefinition 的工厂函数，参数类型完备、可测试、可跨文件复用。

```tsx
interface TeamReportOptions {
  team: string;
  repoUrl: string;
  costBudgetUSD: number;
}

export function makeTeamReport(
  options: TeamReportOptions,
): ReportDefinition {
  return defineReport({
    title: `${options.team} evals`,
    pages: [
      {
        id: "overview",
        title: "Overview",
        render: async (sample) => {
          const performance = await aggregate(sample, {
            by: { agent },
            values: { passRate, costUSD },
          });
          const overBudget = performance.filter(
            (row) =>
              (row.costUSD.value ?? 0) > options.costBudgetUSD,
          );
          return (
            <Col>
              <Scatter
                points={performance}
                x="costUSD"
                y="passRate"
              />
              <Table rows={overBudget} />
            </Col>
          );
        },
      },
      standardAttemptPage,
    ],
  });
}
```

使用方在自己的报告文件里调用工厂并默认导出：

```tsx
import { makeTeamReport } from "@acme/eval-reports";

export default makeTeamReport({
  team: "checkout",
  repoUrl: "https://github.com/acme/checkout-evals",
  costBudgetUSD: 40,
});
```

宿主始终只装载 ReportDefinition，不知道也不需要知道这份定义是不是工厂产出的。
`defineReport` 不收 options 包：闭包已经提供带类型的参数通道，第二个通道只会分裂语义。

三个参数通道各管一段，不互相替代：

| 通道 | 定的时机 | 用途 |
|---|---|---|
| 组件 props | 写代码时 | 单个组件的显示选择 |
| 工厂参数 | 写代码时 | 整份报告的装配选择 |
| 冻结快照模块 | 运行前写盘 | 外部业务数据，报告文件 import |

CLI 不开报告参数：位置参数选 eval，flag 选 agent 与怎么跑，报告的参数走上面三个通道。
外部业务数据的冻结与纯净性规则见 [Architecture · 外部业务数据经 import 冻结](architecture.md#外部业务数据经-import-冻结)。

## 领域分析留在报告旁

公共包不因为当前有一张报告，就导出 `scoreboard()`、`delta()`、`stability()` 或 `history()`。

- history 是 `sample.historyAttempts`，不是计算函数；
- 成对差异由具体报告的 `pairedDelta()` 明确配对规则；
- 稳定性由具体报告的 `stabilityPoints()` 明确公式与阈值；
- 成绩单是产品呈现，不是通用数据原语。

这些函数按需组合公开的 `aggregate()`、AttemptHandle 与 reducer；内建报告没有私有框架通道，也不能直接构造 Calculation 的内部聚合组：

```tsx
const deltaPoints = await pairedDelta(sample, comparison);
const trendPoints = await stabilityPoints(sample.historyAttempts);

return (
  <Col>
    <Scatter points={deltaPoints} x="costUSD" y="passRate" />
    <Bars points={trendPoints} x="run" y="passRate" />
  </Col>
);
```

它们可以与报告一起导出和测试，但不是 `niceeval/report` 顶层 API。
详细边界见 [计算边界](calculations.md)。

## 内建任务结果

每个内建 show 切片导出一个任务函数。
函数只产出普通 Result；text 组件、ShowJson 和对应内建 page 消费同一次调用的结果：

```ts
function standardOverviewResult(
  sample: Sample,
): Promise<StandardOverviewResult>;

function comparisonResult(
  sample: Sample,
  options: ComparisonOptions,
): Promise<ComparisonResult>;

function stabilityResult(
  sample: Sample,
  options?: StabilityOptions,
): Promise<StabilityResult>;

function attemptDetailsResult(
  attempt: AttemptEvidence,
): Promise<AttemptDetailsResult>;

function annotatedSourceResult(
  attempt: AttemptEvidence,
  options?: AnnotatedSourceOptions,
): Promise<AnnotatedSourceResult>;

function conversationResult(
  attempt: AttemptEvidence,
): Promise<ConversationResult>;

function timingResult(
  attempt: AttemptEvidence,
): Promise<TimingResult>;

function usageResult(
  attempt: AttemptEvidence,
): Promise<UsageResult>;

function diffResult(
  attempt: AttemptEvidence,
): Promise<DiffResult>;

function historyResult(
  attempts: readonly AttemptHandle[],
  options?: HistoryOptions,
): Promise<HistoryResult>;
```

这些函数是内建任务的计算单源，不是公共计算内核。
它们可以被自定义报告直接调用，但不会进入 `rollup()` 或 `aggregate()`。
Result 类型以对应 show 切片的 JSON 形状为准，并且不包含 ReportNode。

## 目标与下钻

组件想让读者「点过去看证据」时，交出的是一个目标值，不是 URL：

```ts
interface ReportTarget {
  page: string;
  params?: unknown;
}
```

目标说「哪张页、哪个参数」；URL 长什么样、能不能服务，由宿主的唯一通道回答：

```ts
interface WebRenderContext {
  href(target: ReportTarget): string | undefined;
}
```

宿主对照报告的 pages 清单求 href：目标页存在且参数经该页 `params.encode` 可编码，就给出链接；页不存在、参数编码失败或宿主服务不了，返回 `undefined`，组件把内容按纯文本呈现，不生成空 href 或假链接。
组件因此对宿主能力零知识：view、静态导出、嵌入产品各自决定能服务哪些目标。
text 宿主没有链接，把可服务的目标格式化成下钻命令。

「一个图形点该指向谁」由放点的上层决定，原语不猜。
上层不声明时全库只有一条默认规则：

```ts
function targetOfRefs(
  refs: readonly AttemptLocator[],
): ReportTarget | undefined;
```

`refs` 恰好一个 locator 时返回 attempt 详情目标；零个或多个都返回 `undefined`。
多证据压成一个链接必然指错，宁可不成链。
表格格子不受此限：每条 ref 各成一个单 locator 链接，多 refs 逐条列出。

## 参数化页：attempt 与 experiment 详情

attempt 详情与 experiment 详情都是普通参数化页，不是报告旁边的第二内容槽。
官方内建报告把两页具名导出，用户不需要从已经封装的 ReportDefinition 里反向取 pages：

```tsx
import {
  standardAttemptPage,
  standardExperimentPage,
} from "niceeval/report/built-in";

export default defineReport({
  pages: [
    {
      id: "overview",
      title: "Overview",
      render: overview,
    },
    standardAttemptPage,
    standardExperimentPage,
  ],
});
```

两页的公开全文就是新参数化页的范本：

```tsx
export const standardAttemptPage: PageDefinition<
  { locator: AttemptLocator },
  AttemptEvidence
> = {
  id: "attempt",
  title: "Attempt",
  navigation: false,
  params: {
    encode: ({ locator }) => locator,
    decode: (key) => ({ locator: key as AttemptLocator }),
    enumerate: (base) =>
      base.attempts.map((attempt) => ({
        locator: attempt.locator,
      })),
  },
  load: (_base, { locator }, ctx) => ctx.evidence(locator),
  render: (attempt) => <AttemptDetails attempt={attempt} />,
};

export const standardExperimentPage: PageDefinition<
  { experiment: string },
  Sample
> = {
  id: "experiment",
  title: "Experiment",
  navigation: false,
  params: {
    encode: ({ experiment }) => experiment,
    decode: (key) => ({ experiment: key }),
    enumerate: (base) =>
      toExperimentRows(base).map((row) => ({
        experiment: row.id,
      })),
  },
  load: (base, { experiment }) =>
    base.scope({ experiments: [experiment] }),
  render: (sample) => <ExperimentDetails input={sample} />,
};
```

attempt 页的 `load` 经 `ctx.evidence()` 装载证据；experiment 页的 `load` 只是 Sample 的既有收窄。
「详情页」不是一种类型，只是「参数化 + 不进导航」这个组合的惯用法。

需要自定义详情时替换 `render`，直接读取该页 `load` 给出的输入：

```tsx
render: async (attempt) => {
  const [turns, files] = await Promise.all([
    toConversationTurns(attempt),
    toDiffFiles(attempt),
  ]);

  return (
    <Col>
      <Conversation turns={turns} />
      <DiffView files={files} />
    </Col>
  );
},
```

PageDefinition 本身是可具名导出的普通只读值。
自定义报告可以直接复用官方页，也可以复制其公开全文后修改。

## 自有 React 页面

转换函数可在服务端直接调用：

```tsx
const points = await aggregate(sample, {
  by: { agent },
  values: { passRate, costUSD },
});
```

`points` 是可序列化普通值，可以作为页面 props 发送：

```tsx
import { Scatter, Table } from "niceeval/report/react";

export function EvalsPage({
  points,
}: {
  points: readonly PerformancePoint[];
}) {
  return (
    <>
      <Scatter
        points={points}
        x="costUSD"
        y="passRate"
        point="agent"
      />
      <Table rows={points} />
    </>
  );
}
```

React 包只消费已经算好的普通值，不读取 Sample 或查询引擎。

## 相关阅读

- [Calculations](calculations.md) —— 公共计算内核与报告旁算法。
- [Architecture](architecture.md) —— page 求值、缓存、双面与 React 边界。
- [组件目录](components/README.md) —— 官方显示形状。
- [完整示例](library/examples.md) —— 常见任务的完整报告。
