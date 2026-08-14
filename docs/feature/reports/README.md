# ③ Report（报告层）

Report（报告层）把已经闭合的分析结果组织成可阅读、可比较、可下钻的页面。相同页面同时有 terminal（终端）面、Web（网页）面和可离线分享的 static site（静态站）面。

```text
Sample
  │ aggregate(sample, ...) / query(sample, ...)
  ▼
closed rows / domain views / MetricValue
  │
  ├─ neutral components
  │  Table / Bars / Line / Scatter / Stat
  │
  └─ domain components
     AttemptDetails / TraceViewer / Conversation / DiffView
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

Report 作者不读取 Record、不定义总体或分母，也不接触迁移、文件路径或 Analysis executor。Page 与复合组件在执行期间拿到受限 Sample；它们调用 aggregate() 或 query()，得到 rows、MetricValue 和领域视图等闭合值。

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
| Grid / Stack / Callout | children 或 items | 否 |
| Conversation | turns | 只理解闭合会话形状 |
| Waterfall | nodes | 只理解闭合时序形状 |
| SourceView | source view | 只理解闭合源码形状 |
| DiffView | files | 只理解闭合文件差异 |
| TraceViewer | trace | 是；只接收闭合 TraceView |
| AttemptDetails | evidence | 是；只接收闭合 AttemptEvidence |

中立组件不知道数据来自 aggregate()、query()、业务数组还是外部服务。领域组件可以理解 NiceEval 身份，但不得接收 reader、文件路径、惰性 callback、Promise、Stream 或任何未关闭的 Analysis capability。

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
      load: (_sample, params, context) => context.evidence(params.locator),
      render: attempt => <AttemptDetails attempt={attempt} />,
    },
  ],
});
```

show 未指定 --page 时执行全部普通页面；指定 route 时只执行目标 Page instance。view 同样只为被打开的 route 执行实例。静态导出必须调用每个参数化 Page 的 enumerate(sample)，再闭合全部普通页面和全部列出的实例。

一个 Page instance 的 load、render、复合组件和原语 `resolve()` 在同一份 ReportExecution 中最多执行一次。执行结束后只留下 ClosedReportTree；Sample、reader、Promise、callback 和字段执行器不会进入 renderer。

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
