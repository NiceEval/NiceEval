# 报告作者 API —— Architecture

本篇说明普通值转换模型怎样保住 Sample 口径、聚合正确性、
artifact 懒加载与 text / web 双面一致。
公开写法见 [Library](library.md)。

## 执行模型

宿主运行一份报告时依次完成：

```text
装载 ReportDefinition
  → 校验静态 page 清单
  → 选择一个 page 实例及其输入
  → 执行该 page.render(input)
  → 校验已填充的 page 树
  → text / web renderer
```

page 清单、id、标题、input、导航资格与 Attempt page 唯一性
在装载期可见，不执行任何 page render。
只有被请求的 page 实例会求值；它返回的树中已经没有
待执行的数据声明、Source 或 Promise。
text 与 web renderer 消费该 page 实例的同一棵值树。

```ts
async function renderPage(
  definition: ReportDefinition,
  pageId: string,
  input: Sample | AttemptEvidence,
  external: Readonly<unknown>,
): Promise<ReportNode> {
  const page = definition.pages.find((candidate) =>
    candidate.id === pageId
  );
  if (!page) throw new UnknownPageError(pageId);
  assertPageInput(page, input);
  const tree = await page.render(input, external);
  validateRenderedPage(tree);
  return tree;
}
```

本地 view 按请求求值对应 page 实例。
承载它的宿主协议就是现有站点管线的按需块协议
（[View](../../feature/reports/view.md)）。
`#/page/<id>` 只是浏览器侧的浏览状态；
page 内容按 `report/<pageId>.<locale>.html` 路径请求，
server 因此在请求路径里就知道该求值哪张 page 实例。
`index.html` 只预烘当前订阅的那一块。
静态导出没有按需请求，枚举全部 sample page
与可达 Attempt page 实例，
分别求值后再决定整体写出。
一个 page 实例失败时，本地模式只污染自己的槽位；
静态导出仍保持全有或全无。

`show` 与 `view` 可以分别调用同一 page render。
相同 Sample、外部快照与 NiceEval 版本必须产生字节稳定结果。

## Sample 是范围与正确性的输入

sample page render 直接接收宿主已经选择的 Sample：

```ts
defineReport((sample) => ...);
```

范围变化继续使用 Sample 的现有方法：

```ts
const security = sample.scope({ evals: "security/" });
const reliable = security.filter(isReliableAttempt);
```

`aggregate()` 收 Sample，因为裸数组已经丢失 coverage、issues
与“总体是否改变”的信息。
需要成对比较总体的报告旁函数也应收 Sample。
只分析历史观测的局部函数则显式接收 `sample.historyAttempts`，
不再虚构一个 `history()` 查询。

实体显示可以接收数组：

```tsx
<AttemptList attempts={sample.attempts} />
```

实体列表只投影事实，不重新计算跨题读数，因此不需要 Sample 的聚合语义。

## 所有计算都是函数

报告层计算只有一种公开形态：

```ts
type Transform<Input, Output> =
  (input: Input) => Output | Promise<Output>;
```

官方函数可以读取 AttemptHandle 的惰性 artifact：

```ts
const rows = await toTraceNodes(sample);
```

作者直接 `await` 结果。
框架不把函数包装成 Source，不注册名字，也不推迟到组件解析阶段执行。

每个函数可以独立：

- 在报告中调用；
- 在构建脚本中调用；
- 在单元测试中给 fixture；
- 在服务端调用后把结果交给 React；
- 被另一个普通函数组合。

## 计算函数由同一个组合器产生

两级聚合不能退化成：

```ts
group.map(passRate);
```

官方读数与用户读数都由公开 `rollup()` 产生。
它返回可调用的 Calculation 函数值，并携带聚合与数值语义：

```ts
type Calculation = {
  (group: AggregationGroup): Promise<MetricValue>;
  readonly unit?: string;
  readonly better?: "higher" | "lower";
  readonly bounds?: {
    min?: number;
    max?: number;
  };
  readonly [calculationBrand]: true;
};
```

`rollup()` 是产生 Calculation 的唯一普通入口：

```ts
function rollup(
  value: (
    attempt: AttemptHandle,
  ) => number | null | Promise<number | null>,
  options?: RollupOptions,
): Calculation;
```

官方函数与用户函数使用相同写法：

```ts
export const passRate = rollup(
  passRatePerAttempt,
  {
    withinEval: mean,
    acrossEvals: mean,
    unit: "%",
  },
);

export const changedLines = rollup(
  changedLinesPerAttempt,
  {
    withinEval: min,
    acrossEvals: mean,
    unit: "lines",
  },
);
```

两者进入同一个聚合：

```ts
aggregate(sample, {
  by: { agent },
  values: {
    passRate,
    costUSD,
    changedLines,
  },
});
```

Calculation 品牌不区分官方与用户，只阻止手写一个漏掉 coverage 和 refs 的同形函数。
它存在于不可序列化的函数值上，只在 `aggregate()` 执行前校验，
不会进入 Result、fixture、ShowJson 或 React props。
`rollup()` 自动建立题级分组、过滤 null、计算 samples / total，
把覆盖范围内的全部 Attempt locator 写入 refs，
并把 MetricValue basis 固定为 `"attempt"`。

Reducer 同样是有稳定身份的公开函数值。
内建 `mean`、`sum`、`min`、`max` 与 `percentile(p)` 是纯函数；
空集合统一返回 `null`，`percentile(p)` 的线性插值算法属于公开契约。
不提供通用 `countDistinct`，因为两级 distinct 不能通过题级结果安全合成。

## 结果值

转换函数返回普通可序列化对象和数组。
不存在全局 Content 协议。

各函数可以共享少量真正有跨组件意义的值：

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

`MetricValue` 是一个完成计算的结果，不是计算声明。
表格、图表与摘要读取同一对象：

```tsx
<Stat value={row.passRate} />
<Table rows={[row]} />
<Scatter points={[row]} x="costUSD" y="passRate" />
```

MetricValue 不保存 LocalizedText display。
renderer 使用同一份 `value + format` 和自己的 locale 格式化，
语言切换不要求计算层预烤全部语言。
组件不能修改 `value` 或重算 refs。
AggregateRow 也不能重新进入 `aggregate()`；
类型签名只允许 Sample 作为聚合输入，从而阻止对 summary 再做 summary。

非 rollup 算法通过公开的 `metricValue()` 与 `evidenceRow()` 结束计算。
前者强制声明 samples、total、basis 与 Attempt 证据，
后者把各 MetricValue refs 合成行级 refs。
证据同时接受 AttemptHandle 与 AttemptLocator，
所以从已聚合 MetricValue 派生新读数时直接复用上游 refs。

EvidenceRow 不带 symbol 品牌；组件在运行时结构校验 refs 与 MetricValue，
所以 JSON 往返后仍然有效。
Sample 派生图表只接受 EvidenceRow points；
纯外部 JSON 标量序列经图表的显式 `external` 声明绘图，
没有 Attempt 下钻。
因此领域函数离开核心目录不等于离开证据契约。

## 组件不执行计算

组件只验证和显示传入值：

```text
Table(rows)
Scatter(points)
Callouts(items)
Conversation(turns)
AttemptDetails(attempt)
```

组件不接 Sample、不读取 Record、不调用转换函数，也不处理 Promise。
所有异步在 page render 返回之前完成。

薄组合组件是例外：

```tsx
<AttemptList attempts={attempts} />
```

它只能调用同步、无 IO 的官方投影，例如 `toAttemptRows()`。
需要异步读取 artifact 的组合必须在 page render 中完成，再把结果值交给原语。

## 缓存留在真正拥有 IO 的位置

缓存按能力放在实际拥有 IO 或计算的模块：

| 能力 | 缓存位置 |
|---|---|
| Attempt artifact 读取 | `AttemptHandle` |
| 同一批 Calculation 聚合 | `aggregate()` 的一次调用 |
| 多个读数共享题级分组 | `aggregate()` 内部 |
| page render 结果 | 当前 page 实例的 Promise |
| 静态导出 | 每个 page 实例各自的完成值 |

作者要让两块共享一次异步计算，可以使用普通 Promise：

```tsx
const performancePromise = aggregate(sample, {
  by: { agent },
  values: { passRate, costUSD },
});

const [performance, other] = await Promise.all([
  performancePromise,
  otherCalculation(sample),
]);
```

作者可见语义不把两个分别创建的配置、函数源码或深相等对象判成同一次调用。
共享当前 page 内的一次计算，仍然靠共享上面的 Promise。

跨 page 自动共享计算不作为首版承诺。
两页可以调用同一个普通转换函数，但各自拥有求值与失败边界。
如果性能测试证明重复聚合是瓶颈，再在 `aggregate()` 内部按
Sample 身份、Calculation 身份与分组函数身份增加透明缓存；
这只复用完全相同的稳定函数身份，不猜测两个函数是否等价，
因此是内部优化而不是作者语义。
内联分组闭包每次都是新身份，不承诺命中；
需要命中的热点可以把分组函数提成具名模块值。
缓存命中不改变作者 API。

## 多页逐页惰性求值

```tsx
async function performance(sample: Sample) {
  return aggregate(sample, {
    by: { agent },
    values: { passRate, costUSD },
  });
}

export default defineReport({
  pages: [
    {
      id: "chart",
      title: "Chart",
      render: async (sample) => {
        const points = await performance(sample);
        return (
          <Page title="Chart">
            <Scatter
              points={points}
              x="costUSD"
              y="passRate"
            />
          </Page>
        );
      },
    },
    {
      id: "table",
      title: "Table",
      render: async (sample) => (
        <Page title="Table">
          <Table rows={await performance(sample)} />
        </Page>
      ),
    },
  ],
});
```

打开 chart 不执行 table。
两个 page 分别失败、分别缓存，也不需要字符串数据源注册表。

## Attempt 详情

Sample page 与 Attempt 详情仍属于同一个静态 pages 清单：

```ts
interface AttemptPage {
  id: string;
  input: "attempt";
  navigation: false;
  render: (
    evidence: AttemptEvidence,
    external: Readonly<unknown>,
  ) => ReportNode | Promise<ReportNode>;
}
```

装载期要求至多一张 Attempt page，且它不能进入导航。
宿主解析 locator 后选择这张 page 并传入 AttemptEvidence。
这保留现有“Attempt 详情是一张参数化 page”的寻址、静态导出和无 JS 深链契约，
不重新增加 `attempt`、modal 或其它旁路内容槽。

## 外部冻结值

报告要 join 外部业务快照时，快照作为第二个普通参数：

```ts
function defineReport<External>(
  render: PageRender<Sample, External>,
): ReportDefinition;
```

```tsx
export default defineReport<BudgetSnapshot>(
  async (sample, budgets) => {
    const performance = await aggregate(sample, {
      by: { agent },
      values: { passRate, costUSD },
    });

    const rows = joinBudgets(performance, budgets);
    return <Table rows={rows} />;
  },
);
```

外部值仍由 `--data` 或项目配置在运行前冻结。
page render 不能请求网络、读取环境变量、使用时钟或随机数。

第二参数固定为 External snapshot 入口。
未配置外部快照时宿主传入冻结空值；
join 仍是普通函数，不建立 external data 查询协议。

## React 边界

服务端直接运行相同转换：

```ts
const points = await aggregate(sample, {
  by: { agent },
  values: { passRate, costUSD },
});
```

`points` 可序列化后交给浏览器：

```tsx
<Scatter points={points} x="costUSD" y="passRate" />
```

`niceeval/report/react` 只导出纯 Web 组件和结果类型。
它不需要 Source、resolve、Sample、Record 或 page 运行时。

## show 切片与 `--json` 的锚点

普通函数模型不让 show 从组件树反推数据。
`ShowJson` 信封、view 名和“JSON 是 text 的数据超集”继续保留，
`data` 的单源是公开普通转换函数的结果类型。

每个内建切片只有一个任务函数：

```ts
async function comparisonResult(
  sample: Sample,
): Promise<ComparisonResult>;
```

一次 show 调用先执行它一次，再按输出形态分叉：

```text
comparisonResult(sample)
  ├─ text → ComparisonTable(result)
  └─ json → ShowJson { view: "compare", data: result }
```

内建比较 page 同样调用公开的 `comparisonResult()`。
CLI 的切片注册表只负责“flag → 任务函数 + text 组件”的宿主分派，
不拥有私有计算公式，也不保存一套内建专用结果。
`--stats`、usage、timing、diff 等切片使用同一模式。

自定义 `--report` 与 `--json` 仍互斥：
任意报告树表达“怎么看”，ShowJson 输出稳定的内建任务结果。
宿主不序列化任意组件树，也不通过切树猜出作者想公开的数据。

ShowJson 的 schemaVersion 只在实际线格式变化时递增；
作者 API 的实现变化不能改变信封或 view 语义。

## 本地重建与性能边界

静态 page 清单恢复最重要的增量边界：

- 导航和路由在装载后立即可用，不等待 page 计算；
- 首屏只执行当前 page，trace / diff 等重 page 不预取；
- page render Promise 按 page 实例缓存，失败不污染其它实例；
- 报告或其 import 图变化后，只重新执行当前请求的 page；
- 已填充的 page 树仍可按块 diff 并就地替换。

这不是函数级依赖图。
两张 page 调用同一个聚合时，首版允许各算一次；
实现必须用 view 编辑到可见延迟作为基线做 benchmark，
分别测轻 page、重 artifact page、双页静态导出与失败 page。
如果 page 粒度仍不能满足预算，优先给 `aggregate()` 与 artifact 读取增加
内部透明缓存，而不是把取数管线暴露给作者。
benchmark 必须分别覆盖官方具名分组和内联自定义分组，
不能用前者的命中率代表所有作者代码。

## 自定义显示形状

只有新增显示形状时才需要扩展协议：

```tsx
const ConfusionMatrix = defineRenderer({
  text(value, options, context) {
    return renderTextMatrix(value, options, context);
  },
  web(value, options, context) {
    return <WebMatrix value={value} options={options} context={context} />;
  },
});
```

`defineRenderer` 放在 `niceeval/report/extension`。
它接收已经计算好的普通值，不读取 Sample 或 Record。

自定义计算不需要 `defineSource()`：

```ts
async function computeConfusionMatrix(
  sample: Sample,
): Promise<ConfusionMatrixValue> {
  // 普通 TypeScript
}
```

## 组件自带资产

带交互的显示形状把增强脚本与样式随组件声明，
不要求报告作者替它在外壳登记：

```tsx
const ConfusionMatrix = defineRenderer({
  assets: {
    scripts: ["./confusion-matrix.enhance.ts"],
    styles: ["./confusion-matrix.css"],
  },
  text(value, options, context) {
    return renderTextMatrix(value, options, context);
  },
  web(value, options, context) {
    return <WebMatrix value={value} options={options} />;
  },
});
```

管线在 render 后收集页面上实际出现组件的资产：
按内容哈希物化与去重，按稳定顺序注入，
路径相对组件定义文件解析，
与 head 本地资产走同一条路径纪律。
官方原语的增强 runtime 与 stylesheet 走的就是这条机制，
自定义组件与官方组件平权；
没出现在页面上的组件，资产也不注入。

资产受增强层不变量约束：
初始静态 HTML 无 JavaScript 时完整可读，
脚本只添加浏览行为，不改变数据或初始数值。
站点级第三方注入（埋点、字体、SEO）不属于组件，
声明在外壳的 `head`。

## 错误反馈

错误应指向函数调用或组件属性。

非法分组：

```text
reports/quality.tsx:12
aggregate() 的分组 "vendor" 在 Attempt @... 上抛错。
原因：Unknown model vendor
```

组件字段不存在：

```text
reports/quality.tsx:23
<Scatter x="durationMs" y="passRate">

points 不包含字段 "durationMs"。
可用字段：agent、passRate、costUSD。
```

组件拿到 Promise：

```text
reports/quality.tsx:18
<Table rows={performance}>

rows 收到 Promise。请在 page render 中写：
const performance = await aggregate(...)
```

读数缺数据不是异常。
MetricValue 保留 `value: null`、samples、total 与 refs。

开发态错误还应携带结果路径。
例如 `points[3].costUSD` 不是可绘制值时，
诊断同时给出组件属性、行号、字段名和该 MetricValue 的 refs。
结果本身是普通可序列化值，作者可直接 `console.dir()`、
保存 fixture 或写 JSON；不增加只为查看内部 Content 的 `inspect()` API。

## 相关阅读

- [Library](library.md) —— page、计算函数、转换函数与组件的公开形状。
- [Calculations](calculations.md) —— 公共计算内核和报告旁算法的边界。
- [view](view.md) —— 本地浏览与静态导出的宿主协议。
- [References](reference/authoring.md) —— 普通值作者面与双面渲染的外部依据。
