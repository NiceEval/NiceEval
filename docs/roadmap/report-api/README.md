# 报告作者 API

Roadmap 候选设计，见 [Roadmap 约定](../README.md)。
本主题重新设计 `niceeval/report` 的报告作者面，并明确提议修改
[Reports 当前定稿契约](../../feature/reports/README.md)中的
Source / Composition 求值机制。
在本 Roadmap 被采纳并完成迁移前，feature 文档仍是当前唯一目标契约。

候选模型只有一条主线：

```text
静态 ReportDefinition / page 清单
  → 一个 page 的 Sample / Attempt Evidence 输入
  → 普通 TypeScript 函数
  → 可序列化结果值
  → 报告组件
  → text / web
```

单页报告是一个接收 Sample、返回报告树的惰性 page 函数；
多页报告静态声明 pages，每页各有自己的惰性 render。
官方读数与实体投影是普通转换函数。
组件接收 `rows`、`points`、`value`、`items`、`attempt` 等具体属性。

公开作者面不出现 `data`、`Source`、`Content`、`View`、`MetricView`、
`Composition`、`ctx.resolve()` 或惰性查询对象。

完整候选 API 见 [Library](library.md)，计算准入见 [Calculations](calculations.md)，
内部边界见 [Architecture](architecture.md)，外部产品对照见 [References](references.md)。

## 问题

当前作者面把运行管线直接暴露成 `Measure`、`Source`、`Content`、
`Composition` 与 `Component`。
这些概念能精确描述框架怎样执行，却不能直接表达作者的任务。

下面的常见问题是“按 Agent 比较通过率与成本”：

```tsx
const performance = sources.measure.rows({
  dimensions: ["agent"],
  measures: [passRate, costUSD],
});

export default defineReport(
  <Table source={performance} />,
);
```

作者必须理解 `sources.measure.rows` 为何是工厂、`passRate` 为何是对象，
以及 `Table` 何时接 `source`、何时接 `data`。
要复用一个动态区块，还要学习 `defineComposition`、page input 与 `ctx.resolve()`。

这些知识不帮助作者提出问题、转换值或组织页面。
它们只是框架内部执行阶段的公开投影。

## 候选写法

同一个问题改写为普通函数：

```tsx
import {
  Page,
  Scatter,
  Table,
  agent,
  aggregate,
  costUSD,
  defineReport,
  passRate,
} from "niceeval/report";

export default defineReport(async (sample) => {
  const performance = await aggregate(sample, {
    by: { agent },
    values: { passRate, costUSD },
  });

  return (
    <Page title="Quality and cost">
      <Scatter
        points={performance}
        x="costUSD"
        y="passRate"
        point="agent"
      />
      <Table rows={performance} />
    </Page>
  );
});
```

作者只需要理解：

1. `sample` 是宿主选好的普通 Sample。
2. `aggregate()` 把 Sample 转成结果行。
3. `Scatter` 显示 points，`Table` 显示 rows。

`passRate`、`costUSD` 与 `agent` 由 NiceEval 官方提供。
它们与用户函数使用相同的公开组合器和调用路径，没有官方专用计算协议。

## 实体列表也是普通值

Sample 已经公开物化、去重后的 `attempts`。
筛选、排序和截断使用现有 Sample 方法与普通数组方法：

```tsx
export default defineReport((sample) => {
  const security = sample
    .scope({ evals: "security/" })
    .filter((attempt) =>
      attempt.result.verdict === "failed" ||
      attempt.result.verdict === "errored"
    );

  const attempts = security.attempts
    .toSorted((a, b) =>
      (attemptCostUSD(b.result) ?? 0) -
      (attemptCostUSD(a.result) ?? 0)
    )
    .slice(0, 50);

  return (
    <Page title="Failures">
      <AttemptList attempts={attempts} />
    </Page>
  );
});
```

这里没有一个伪装成数据的查询声明。
`security` 是 Sample，`attempts` 是 `AttemptHandle[]`，
组件接收的也是 `attempts`。

如果作者要使用通用表格，先显式转换成行：

```tsx
const rows = toAttemptRows(attempts);

return <Table rows={rows} />;
```

`toAttemptRows()` 是立即执行的普通转换。
它不注册数据源，不读取 page context，也不等待渲染器调用。

## 设计原则

- **值先于协议。** 能用 Sample、AttemptHandle、数组和对象表达的能力不包装成查询对象。
- **转换就是函数。** 官方计算只有 `Input → Output | Promise<Output>` 一种形态。
- **组件属性说出角色。** 表格接 `rows`，散点图接 `points`，摘要格接 `value`，
  Attempt 详情接 `attempt`。
- **page render 拥有异步。** 需要读取 artifact 时直接 `await`，不增加 Composition 概念。
- **page 是必要的声明边界。** page 清单静态可见，内容逐页惰性求值和失败隔离；
  普通值模型不等于把整份报告变成一个不透明函数。
- **正确性留在组合器。** 两级聚合、覆盖与 refs 由 `rollup()` 和 `aggregate()` 保证，
  官方函数与用户函数走同一条路。
- **复杂读数仍欠证据。** 非 rollup 算法通过 `metricValue()` 和
  `evidenceRow()` 声明分母、basis 与 refs。
- **范围必须可见。** 共享过滤先产生一个具名 Sample；
  内建报告和组件不能藏只对自己生效的过滤。
- **普通 JavaScript 是组合语言。** 过滤、排序、截断、join 与并行使用语言已有能力。
- **组件按形状准入。** 组件目录按渲染形状增长；
  领域名词只能命名函数或内建报告，不能命名组件。
- **结果一次生成、双面消费。** 一个 page 实例只执行一次，
  text 与 web renderer 读取同一棵结果树。
- **高级扩展也是函数。** 自定义转换不注册；自定义显示形状才需要双面 renderer 协议。

## 公开概念

普通报告作者只需要六类概念；单页报告可以忽略 page 配置：

| 概念 | 例子 |
|---|---|
| 静态 page 定义 | `{ id, title, input, navigation, render }` |
| 输入值 | `Sample`、`AttemptEvidence`、冻结 External snapshot |
| Reducer、分组与计算函数 | `mean`、`percentile(0.95)`、`agent`、`passRate` |
| 普通转换 | `aggregate()`、`pairedDelta()`、`toAttemptRows()` |
| 结果值 | rows、EvidenceRow / ExternalPoint、items、MetricValue |
| 组件 | `Table`、`Scatter`、`Callouts`、`AttemptDetails` |

“结果值”不是一个需要 import 的总协议名。
每个函数返回精确的 TypeScript 类型，每个组件声明自己接受什么。

## 不追求什么

- 不建立 `data.*`、`views.*` 或字符串查询目录。
- 不让同一个组件支持 `source` / `data` / `view` 多种绑定。
- 不引入 SQL、模板变量或另一门表达式语言。
- 不把数组的 `filter`、`sort`、`map` 重新包装成框架 DSL。
- 不让报告作者实现新的查询协议；
  标量计算使用 `rollup()`，复杂计算使用统一证据结果构造器。
- 不让 Web renderer 重新取数或聚合。
- 不要求组件作者以外的人理解 text / web renderer 协议。

## 待裁决分歧

1. **`aggregate()` 的 `by`。** 使用官方函数值 `{ agent, experiment }`，
   还是字符串数组 `["agent", "experiment"]`。
   当前倾向函数值：可重命名、可跳转、可组合，而且不引入字段字符串 DSL。
2. **自定义分组。** 是否允许作者传普通函数：
   `by: { vendor: (attempt) => vendorOf(attempt) }`。
   当前倾向允许；分组函数只产生字符串，不承担聚合正确性。
3. **高级计算。** 当前不开放内部 AggregationGroup，
   只提供 `metricValue()` / `evidenceRow()` 结果构造器。
   spike 需要证明它们足以表达 delta、scoreboard 与 stability 的分母和 refs；
   证明失败才重新讨论更低层输入协议。
4. **转换函数命名。** 实体投影使用 `toAttemptRows()`，
   还是 `attemptRows()`。
   当前倾向 `to*`：名字明确表示立即转换，不像惰性目录成员。
5. **内建报告复用。** 是否允许 `defineReport(standard, override)`。
   当前倾向不引入继承；官方导出 `standard` ReportDefinition
   及其使用的普通任务函数和具名 PageDefinition
   （例如 `standardAttemptPage`）。
   作者可以直接选用、放进自己的 pages 数组，或复制公开全文后修改。

## 三项宿主裁决

1. **页粒度。** 多页定义必须用非空有序数组静态列出 page；
   宿主逐页执行 render。
   首屏不计算其它 page，失败隔离和缓存以 page 实例为单位。
2. **非 rollup 证据。** Sample 派生图表只接受 EvidenceRow；
   复杂算法通过 MetricValue 构造器强制提交 samples、total、basis 与 refs。
3. **show / JSON。** `ShowJson` 信封继续存在；
   每个内建切片由一个公开任务函数产出普通 Result，
   text 组件和 JSON 序列化消费同一次结果，不从报告树切数据。

## 验收场景

候选 API 定稿前至少写出这些完整报告：

1. 按 Agent 比较通过率与成本，并同时显示散点和表格。
2. 收窄 `security/` Eval 后列出失败 Attempt。
3. 用 `sample.historyAttempts` 计算按 Run 展示的历史趋势。
4. 用报告旁的普通函数计算成对差异与稳定性。
5. 组合 Sample Issue、Run diagnostics 与摘要读数。
6. 从聚合 MetricValue 下钻到 Attempt 详情。
7. 写一个接收 Sample 的普通异步函数，在两张 page 复用。
8. 把转换结果传给自有 React 页面。
9. 组件库作者定义一个新的双面显示形状。
10. 多页报告只执行被请求 page；其中一页失败时其它 page 仍可用。
11. Attempt 详情作为 `input: "attempt"` 的参数化 page 静态导出和深链。
12. 每个内建 show 切片的 text 与 ShowJson 共用同一任务结果。
13. 切换 locale 只重新格式化 MetricValue，不重新运行 page 计算。
14. EvidenceRow 经 JSON fixture 和 React props 往返后无需水化即可渲染。
15. page id 即使是 `"1"` 或 `"2024"`，导航仍严格服从 pages 数组顺序。
16. 纯外部预算时间序列可作为 ExternalPoint 绘图，且不出现 Attempt 下钻。
17. 自定义报告直接复用官方导出的 `standardAttemptPage`。
18. 按固定题集 rubric 手写成绩单：缺题保持固定分母，
    总分 evidence 复用各题格 MetricValue 的 refs。
19. 业务目标线作为 series 级 ExternalPoint 叠加在 Sample 派生图上。

普通场景 1–8 不得出现 `data`、`Source`、`Content`、`View`、
`Measure`、`Composition`、`ctx`、`resolve` 或 `compute`。

## 相关阅读

- [Library](library.md) —— page render、`aggregate()`、结果值、组件与完整示例。
- [Calculations](calculations.md) —— 为什么没有 Sample map，以及哪些领域算法不进核心 API。
- [Architecture](architecture.md) —— 执行时机、缓存、双面边界与 React 嵌入。
- [References](references.md) —— 外部产品中可借与不可借的部分。
- [Sample](../../feature/sample/README.md) —— sample page 接收的物化输入。
- [当前报告作者面决策](../../design/report-authoring/DECISION.md) —— 被本候选重新评估的定稿依据。
