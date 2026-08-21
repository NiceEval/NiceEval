# ③ Report（报告层）

Report（报告层）把固定 Sample（样本）的闭合 Analysis（分析）值组织成标准 React JSX 页面，并交付给终端或离线可读站点。作者只声明
`defineReport()`、Page（页面）和组件；Record reader、文件路径、watcher 与 renderer 都留在 Host（宿主）边界。

Report 有两条明确不同的执行路径。它们共享同一份作者定义与 Analysis 口径，却不把快速终端读取伪装成全站生成。

| 用户入口 | 执行范围 | 交付值 |
|---|---|---|
| `niceeval show`、`niceeval show --json` | 一个已选择的 route。普通页只执行该页；参数页只解码并执行给定 key。 | 临时关闭的单页 text，或 Host 持有的机器文档。 |
| `niceeval view`、`niceeval view --out` | 所有普通 Page 与每个参数 Page 的全部枚举实例。 | 一个完整的 `ClosedSiteRevision`（闭合站点版本）。 |

```text
                    ReportDefinition + fixed Sample
                               │
              ┌────────────────┴────────────────┐
              ▼                                 ▼
  show: select one exact route       site: enumerate every Page instance
              │                                 │
     private `ResolvedPage`              validate the complete site
              │                                 │
      terminal text / JSON              ClosedSiteRevision
                                                │
                                  ┌─────────────┴─────────────┐
                                  ▼                           ▼
                                view                     view --out
```

`show` 不调用参数 Page 的 `enumerate()`，不建立 `ClosedSiteRevision`，也不为未选 route 执行作者 callback。

`project-current` 仍是整个项目的 Sample。只有一个可比实验范围时，标准 Overview 直接从父 Sample 形成该范围的 `ExperimentComparisonScope`。有多个范围时，标准 Report 内容交付各范围的普通 Page 链接；通用 Header 不理解实验组。Hero、通知、Summary、图表和 Table 都消费目标 Page 背后的同一 narrowed Sample。

切换选项只改变根 document 的 hash，不新增 CLI 参数或 HTTP 路径。`show` 的多组默认输出仍是可复制命令的实验索引。每个 Page 把唯一 scope 交给具名比较组件；任何比较组件都不能跨范围。
`view` 与静态导出则必须完成全站枚举、链接校验、资源闭包和限额检查；它们只从同一个 revision 读取最终 bytes。

[Report 成本投影](cost-projections/README.md) 是完整的成本契约。它只经 `ReportDefinition.pricing` 接入 Report，并以同一只读值暴露为
`ctx.report.pricing`；Config、Host 与 Runner price table 不能提供第二份价格。这个入口也定义成本 Page 在单目标 `show` 与全站
`view` / `view --out` 中的闭合范围。

## 作者心智

报告文件使用标准 React JSX。项目只需 TypeScript 的 `jsx: "react-jsx"`，由 `react/jsx-runtime` 处理 JSX；没有 NiceEval JSX
runtime、pragma 或 `jsxImportSource`。

```tsx
import { aggregate, Bars, defineComponent, defineReport, Grid, model, passRate, Table } from "niceeval/report";

const Overview = defineComponent(async (_props, ctx) => {
  const rows = await aggregate(ctx.scope, { by: { model }, values: { passRate } });
  return <Grid><Bars points={rows} x="model" y="passRate" /><Table rows={rows} /></Grid>;
});

export default defineReport({
  title: "Quality",
  pages: [{ id: "overview", path: "/", title: "Overview", presentation: "page", render: () => <Overview /> }],
});
```

上例只说明组合形态。`aggregate()`、`MetricValue`、两种 `defineComponent()`、Page 与 `ctx.report` 的精确形状由
[Library](library.md) 定义。Analysis 拥有总体、分母、缺口、Evidence（证据）与计算；Report 只能组织其闭合返回值。

组件有组合形态和 text/web 双面形态。组合形态可在 Sample 存活时取得闭合数据；双面形态先取得一次关闭输入，再让同步的
`text()` 与 `web()` 分别呈现同一值。网页、终端和静态目录不会再次调用 Analysis。

## 站点版本与离线阅读

`ClosedSiteRevision` 包含一个根 `index.html` app shell、每个已关闭 Page 或 overlay 的 HTML fragment、rendered text、CSS 与唯一 app client。它还包含作者声明的 asset、下载文件、`_niceeval/data/projections.json` 和 Host 问题表。fragment 和 `projections.json` 的 bytes 都属于 revision identity。它不包含 Sample、Record reader、
Promise、callback、React element 或组件函数。

`view` 托管一个已验证 revision；`view --out` 写出同一 revision。两者都只交付一个根 app shell，并由唯一外部 manifest 把 hash route 指向已关闭 fragment；shell 不内联第二份 route 数据。HTTP header、
连接和更新通知不改变 revision bytes。

两种站点都携带同一个 app client。live view 通过 app 响应 header 启用 reload；静态目录不会探测刷新端点。目录不依赖外部网络、Record 或 NiceEval 安装，且可由普通静态 HTTP(S) host（包括 Netlify）直接托管，不需要 rewrite 或 NiceEval server。浏览器必须启用 JavaScript；禁用时根 shell 明确报错，不维持另一套阅读与导航逻辑。`file://` 不受支持。

## 结构化 head 与站点资产

作者通过 `head` 声明 `meta`、`link`、`style` 与 `script`。script 是结构化标签而非 raw HTML；内联 bytes、属性顺序与本地 asset
都进入 revision identity。外部 `src` 可以带 `integrity`、`crossorigin` 与 `referrerpolicy`，但远端响应不属于 revision bytes。

唯一 app client 负责页面阅读、导航、详情交互与 live reload。作者脚本可以增强作者内容，但不能替代已闭合的正文、Evidence 或机器文档。app client 与作者 script 属于不同命名空间，
view 不注入只在本机有效的作者脚本。

## 数据、机器输出与样式边界

`MetricValue` 始终保留 `value`、`state`、`samples`、`total`、`issues` 与 `refs`。合法零值不是空值；显示组件不得靠筛选行数
重写分母或隐藏问题。完整数值语义见[读数与显示语义](calculations.md)。

`show --json` 的内建报告和自定义报告各有固定 format。内建报告输出 Host-owned 领域数据；自定义报告输出单目标执行 manifest 与
选中 Page 的已呈现文字，不序列化通用作者树或 site revision。format、locale、route 选择与 canonical order 由 [CLI](cli.md) 定义。

所有内建 `show --json` Page 使用同一个 `niceeval.show` 文档 format；format 只标识机器文档类型，不承担版本或迁移语义，
也不随当前 Page 改变。该 API 与生产者同步演进；持久化版本只属于 Record。
单组默认输出 `experiment-group`，多组 Overview 输出 `groups`，不建立跨组 leaderboard；实验组 Page 的 `comparison` 穷尽
`comparable | non-comparable`。

报告样式只有一个产品 owner：Report CSS 负责 reset、基础排版、theme token 消费和所有报告组件。View shell 左侧放品牌，中间居中整个
Page router，右侧放实验与语言两个原生选择器；Page router 无论含一个还是多个 Page 都作为整体居中。Shell 不重绘 Report 内容。

每个报告只有一个根 document。作者可声明多个业务 Page；Hash router 把它们呈现在同一 document 中。Page 的 `presentation` 明确为 `page` 或 `overlay`。Attempt、Source 和 Diff 使用 `overlay`，不是独立业务 Page。overlay 使用半透明黑色 backdrop，保留当前业务 Page 作为可见上下文，内容面板保持不透明。点击内容外侧、按 Escape、点击关闭按钮或浏览器返回都会关闭 overlay 并恢复前一 hash。
完整边界见 [Architecture](architecture.md#css、theme-与-view-shell)。

## 范围与入口

Report 包含作者 DSL、Analysis facade、标准 React 组件、单页终端读取、全站关闭、view、静态目录与下载文件。`pages` 是唯一 Page 集合；
作者明确声明业务 Page 和 overlay，Host 不补建任何 route HTML 或详情页面。
Report 不包含 Record 格式、浏览器端 Analysis、任意文件读取、通用 semantic author model 或第二条 CSS / renderer 管线。

- [Library](library.md)：公开 export manifest、作者 API、Page、组件与闭合值。
- [成本投影](cost-projections/README.md)：Profile、Analysis 成本读数与 machine / site 闭合。
- [读数与显示语义](calculations.md)：MetricValue、分母、GroupFunction 与领域投影。
- [Architecture](architecture.md)：两条执行路径、revision、CSS、reload 与预算。
- [CLI](cli.md)：选择、`show`、JSON、`view` 与静态导出。
- [Use case](use-case/README.md)：比较、完整度、静态分享与浏览器阅读。
- [Reference](reference/README.md)：外部材料入口。
