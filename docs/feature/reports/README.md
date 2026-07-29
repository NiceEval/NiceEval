# Reports —— 查看与呈现结果

Reports 把宿主选好的 Sample 或 Attempt Evidence 转成一棵报告组件树，
再由 `show` 与 `view` 分别渲染成 text 与 web。
报告作者只选择官方数据、显示形状与页面，不接触内部取数和双面渲染管线。

作者模型只有一条主线：

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

公开作者面不出现惰性查询对象或组件级 `data` 绑定；
组件按角色接收 `rows`、`points`、`value`、`items` 等具体属性。

完整 API 见 [Library](library.md)，计算准入见 [Calculations](calculations.md)，
内部边界见 [Architecture](architecture.md)，外部产品对照见
[References](reference/authoring.md)。

## 基本写法

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
- **page render 拥有异步。** 需要读取 artifact 时直接 `await`。
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
- **壳只装宿主必需品。** 外壳保留宿主机器在 page render 之外
  必须消费的字段；跨页内容用普通组合，组件资产随组件声明。
- **参数没有新协议。** 组件收 props，报告收工厂闭包参数，
  外部业务数据走 import 的冻结快照模块；CLI 不开报告参数。
- **结果一次生成、双面消费。** 一个 page 实例只执行一次，
  text 与 web renderer 读取同一棵结果树。
- **高级扩展也是函数。** 自定义转换不注册；自定义显示形状才需要双面 renderer 协议。

## 公开概念

普通报告作者只需要六类概念；单页报告可以忽略 page 配置：

| 概念 | 例子 |
|---|---|
| 静态 page 定义 | `{ id, title, input, navigation, render }` |
| 输入值 | `Sample`、`AttemptEvidence` |
| Reducer、分组与计算函数 | `mean`、`percentile(0.95)`、`agent`、`passRate` |
| 普通转换 | `aggregate()`、`pairedDelta()`、`toAttemptRows()` |
| 结果值 | rows、EvidenceRow / ExternalPoint、items、MetricValue |
| 组件 | `Table`、`Scatter`、`Callouts`、`AttemptDetails` |

“结果值”不是一个需要 import 的总协议名。
每个函数返回精确的 TypeScript 类型，每个组件声明自己接受什么。

## 边界

- 不建立 `data.*`、`views.*` 或字符串查询目录。
- 不让同一个组件支持 `source` / `data` / `view` 多种绑定。
- 不引入 SQL、模板变量或另一门表达式语言。
- 不把数组的 `filter`、`sort`、`map` 重新包装成框架 DSL。
- 不让报告作者实现新的查询协议；
  标量计算使用 `rollup()`，复杂计算使用统一证据结果构造器。
- 不让 Web renderer 重新取数或聚合。
- 不要求组件作者以外的人理解 text / web renderer 协议。

## 宿主边界

1. **页粒度。** 多页定义必须用非空有序数组静态列出 page；
   宿主逐页执行 render。
   首屏不计算其它 page，失败隔离和缓存以 page 实例为单位。
2. **非 rollup 证据。** Sample 派生图表只接受 EvidenceRow；
   复杂算法通过 MetricValue 构造器强制提交 samples、total、basis 与 refs。
3. **show / JSON。** `ShowJson` 信封继续存在；
   每个内建切片由一个公开任务函数产出普通 Result，
   text 组件和 JSON 序列化消费同一次结果，不从报告树切数据。
4. **壳收缩到宿主必需品。** 外壳只保留 `title`、`theme`、
   `dimensionPins` 与 `head`；
   页脚与页头链接是普通内容，组件脚本样式随组件资产声明，
   站点级注入走 `head`。

## 契约场景

实现与测试至少覆盖这些完整报告：

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
16. 纯外部预算时间序列经显式 `external` 声明绘图，且不出现 Attempt 下钻。
17. 自定义报告直接复用官方导出的 `standardAttemptPage`。
18. 按固定题集 rubric 手写成绩单：缺题保持固定分母，
    总分 evidence 复用各题格 MetricValue 的 refs。
19. 业务目标线作为显式 `external` series 叠加在 Sample 派生图上。
20. 未声明 `external` 的图表拒绝无 refs 的 points，错误指向组件与字段。
21. `by` 与 `values` 键冲突或占用保留键 `refs` 时，
    编译期与执行期都拒绝并指出冲突键。
22. 页脚与页头链接作为普通内容包进每页 render，宿主没有对应槽位。
23. 自定义显示形状随组件声明 assets，页面只注入实际出现组件的资产。
24. 工厂函数产出带参数的 ReportDefinition，使用方传 opts 后默认导出。

普通场景 1–8 只用公开转换函数与具体 props；
不出现待求值的查询对象或组件级 `data` 绑定。

## 相关阅读

- [Library](library.md) —— page render、`aggregate()`、结果值、组件与完整示例。
- [Calculations](calculations.md) —— 为什么没有 Sample map，以及哪些领域算法不进核心 API。
- [Architecture](architecture.md) —— 执行时机、缓存、双面边界与 React 嵌入。
- [References](reference/authoring.md) —— 外部产品中可借与不可借的部分。
- [Sample](../sample/README.md) —— sample page 接收的物化输入。
