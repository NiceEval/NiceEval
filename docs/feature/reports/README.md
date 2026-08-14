# ③ Report（报告层）

Report（报告层）把已经闭合的分析结果组织成可阅读、可比较、可下钻的页面。相同页面同时有 terminal（终端）面、Web（网页）面和可离线分享的 static site（静态站）面。

```text
Sample
  │ aggregate(sample, ...) / query(sample, ...)
  ▼
closed rows / domain views / MetricValue
  │
  ├─ rows → Table
  ├─ points → Bars / Line / Scatter
  ├─ MetricValue → Stat
  └─ closed domain view → compose component or dual-face primitive
  │
  ▼
defineReport({ pages })
  │
  ▼
ClosedReportTree
  ├─ niceeval show
  ├─ niceeval view
  └─ static export
```

## 作者心智

Report 作者不读取 Record、不定义总体或分母，也不接触迁移、文件路径或 Analysis executor。Page 与复合组件在执行期间拿到受限 Sample；它们先调用 aggregate() 或 query()，再把 rows、MetricValue 和领域视图等闭合值交给组件。

`niceeval/report` 是作者 API。`niceeval/report/host` 是公开、受支持的高级 Host composition SDK，供 CLI、替代
CLI / Web host 或深度应用集成执行、呈现、提供 view 和导出闭合 Report。普通 Report 作者不导入 Host entry，
也不会取得 Record reader、loader、watcher 或 renderer。

defineReport({ pages }) 是唯一的报告定义入口。普通 Page 使用 load? 和 render；需要一组详情地址的 Page 使用 params、load 和 render。params.enumerate(sample) 是静态导出的完整实例清单，不会在浏览器地址栏临时制造另一份数据读取。

Report 允许普通 async TypeScript。每次 aggregate() 调用只编译并执行该调用需要的有限 Analysis 依赖，随后按 frozen Sample 和字段 identity 缓存。它不要求在执行 Page 之前预跑整份报告，也不会为探测依赖而执行作者回调两次。

## 两种组件

组合组件异步取得闭合值，再装配已有组件：

```tsx
const ModelComparison = defineComponent(async (_props, { sample }) => {
  const rows = await aggregate(sample, {
    by: { model },
    values: { passRate, duration },
  });

  return (
    <Grid>
      <Bars points={rows} x="model" y="passRate" />
      <Table rows={rows} />
    </Grid>
  );
});
```

新显示原语用另一种 defineComponent() 形态，同时提供同步的 text face（终端面）和 web face（网页面）。可选的 `resolve()` 在呈现前求值闭合数据，是唯一异步阶段；两个面只接收同一个结果。

只实现网页面会让 show 成为二等入口。因此 text、web 和静态的无 JavaScript 降级是同一原语的共同合同。

## 中立组件与领域组件

| 组件 | 输入 | 是否理解 NiceEval 领域 |
|---|---|---|
| Table | rows | 否 |
| Bars / Line / Scatter | points | 否 |
| Stat | MetricValue | 否 |
| Grid / Stack / Callout | children | 否 |
| 复合组件 | 已闭合 rows、MetricValue 或领域视图 | 只读取作者显式传入的闭合值 |
| 双面原语 | 求值后的闭合值 | text 与 web 同步读取同一个值 |

中立组件不知道数据来自 aggregate()、query()、业务数组还是外部服务。它们不接收、也不依赖 Analysis 的查询外层对象：表格只读 rows，图形只读 points，Stat 只读完整 MetricValue。需要解释领域视图时，作者用 defineComponent() 先把它转成同一组语义节点；组件不得接收 reader、文件路径、惰性 callback、Promise、Stream 或未关闭的 Analysis capability。

内建 Attempt overview 也遵守这条规则：它只请求闭合的 Attempt Evidence、Attempt Observability 与 File Changes，
并按 canonical locator 显式对齐。Evidence 显示 Core outcome、由权威 fold 得到的 Verdict 和 Assertions；
`AttemptTrace` 显示 Observability 的 command、diagnostic 和其公开文本。

File Changes 默认显示按 send 区间排列的 trajectory（轨迹）与 collection。reliable `net` 只能作为摘要或
`DiffView`（差异视图）的输入；它不是默认替代品。完整空轨迹、partial 的空安全前缀与 `not-recorded` 都显示为
不同状态，partial limitation 与 `indeterminate` issue 不能被页面隐藏。缺 entry 或 duplicate locator 也作为对齐状态
显示，不能按数组位置配对。Report 不读取 Record，也不重算 Verdict 或 `net`。

## MetricValue

从 Sample 派生的数值始终保留完整度和证据，不能拆成 number 后重新包装。MetricValue 的 exact 形状由 [Library](library.md#metricvalue) 定义。

samples 是实际贡献数，total 是既定分母。Table、图形和 Stat 必须保留 state、issues 与 refs，不能把 partial 显示成完整值，也不能把 null 猜成零。

## 页面、路由与三种呈现面

一个参数化 Page 表达全部 Attempt 详情实例：

```tsx
defineReport({
  pages: [
    {
      id: "attempt",
      path: "/attempt",
      title: "Attempt",
      navigation: false,
      params: attemptParams,
      load: async (_sample, params, context) => await context.evidence(params.locator),
      render: evidence => <EvidenceSummary evidence={evidence} />,
    },
  ],
});
```

`EvidenceSummary` 是作者用 `defineComponent()` 定义的组件；它只接收 `context.evidence()` 已关闭的值。

show 未指定 --page 时执行全部普通页面；指定 route 时只执行目标 Page instance。view 同样只为被打开的 route 执行实例。静态导出必须调用每个参数化 Page 的 enumerate(sample)，再闭合全部普通页面和全部列出的实例。

一个 Page instance 的 load、render、复合组件和原语 `resolve()` 在同一份 ReportExecution 中最多执行一次。`context.evidence(locator)` 异步走同一条 Analysis DomainView 请求，只惰性读取属于当前 Sample 的那个 Attempt，并返回闭合 Evidence。执行结束后只留下 ClosedReportTree；Sample、reader、Promise、callback 和字段执行器不会进入 renderer。

## 范围

Report 包含：

- Page、路由、下载项、闭合组件树与三种呈现面；
- neutral rows、points、MetricValue 和闭合领域视图；
- 局部 Page 失败隔离、不可隐藏的问题面和类型化 host error；
- 热重载的 last-good revision，以及 self-contained static export。

Report 不包含：

- Record 格式、写入、迁移计划或 Analysis 的总体、分母和度量算法；
- 原始事实读取、任意持久载荷访问或浏览器端再次查询；
- 浏览器的任意 script、style、font、worker、WASM、网络 URL 或路径 loader；
- 不受信任 Report module 的安全沙箱；
- durable Report snapshot、第二种 Record、Worker、RPC、bundler 或原子目录发布细节。

## 入口

- [Library](library.md)：作者 API、闭合树、路径、下载与类型化错误。
- [数值与显示语义](calculations.md)：MetricValue、分母和 rows 的边界。
- [Architecture](architecture.md)：执行、验证、隔离、热重载与导出不变量。
- [CLI](cli.md)：show、view 与 view --out。
- [Use case](use-case/README.md)：比较、完整度、静态分享与可访问页面。
- [Reference](reference/README.md)：外部材料入口。
