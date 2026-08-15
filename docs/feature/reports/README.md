# ③ Report（报告层）

Report（报告层）把固定的 Analysis（分析）结果编译成一次可离线阅读的站点。作者写 Report，Host（宿主）构建站点；浏览器、
终端和导出目录只读取已经关闭的内容。

关键英文术语首次出现时都给出中文：

- ReportDefinition（报告定义）、Sample（样本）、Page（页面）和 JSX（JavaScript XML 元素）。
- ClosedRows（闭合行）、MetricValue（度量值）和 ClosedSiteRevision（闭合站点版本）。
- buildSiteRevision()（全站版本构建）、revision（站点版本）、route（路由）和 builder（构建器）。
- renderer（呈现器）、HTML（超文本标记）、body bytes（正文原始字节）和 content-addressed（内容寻址）。
- asset（静态文件）、download（下载文件）、Record（已封口事实集）、Evidence（证据）和 HTTP（超文本传输协议）。
- identity（身份）、callback（回调）、Scope（作用域）、inline CSS（内联样式）和 manifest（清单）。
- show（终端展示）、view（本机网页）、static（静态导出）和 JSON（机器文档）。
- watcher（变更监听器）、last-good（最后一次完整成功版本）、latest-intent-wins（最新意图优先）和
  refresh transport（刷新通知通道）。

```text
ReportDefinition + fixed Sample
             │
             ▼
   buildSiteRevision()
             │ enumerate every Page, execute, and validate globally
             ▼
   ClosedSiteRevision
   ├─ closed page projections
   ├─ final HTML body bytes
   ├─ final assets and download bytes
   └─ content-addressed identity
             │
   ┌─────────┼──────────┬───────────┐
   ▼         ▼          ▼           ▼
 show     show --json  view    view --out
```

同一 revision（站点版本）先完成全站构建，四个入口才选择各自的投影。没有正式 builder（构建器）会根据阅读目标
减少全站范围。`--page` 只选择已经存在于 revision 中的 route（路由）。

## 作者心智

作者沿用 v0.12 风格：用 `defineReport()` 声明 Page，用 `defineComponent()` 组合组件，用 JSX 写页面，并在构建阶段自由调用
Analysis API。作者不构造 `Sample`，不接触 Record reader，也不需要理解 `ClosedSiteRevision` 的文件结构。

```tsx
import {
  aggregate,
  Bars,
  defineComponent,
  defineReport,
  Grid,
  model,
  passRate,
  Table,
} from "niceeval/report";

const Overview = defineComponent(async (_props, { sample }) => {
  const rows = await aggregate(sample, {
    by: { model },
    values: { passRate },
  });

  return (
    <Grid>
      <Bars points={rows} x="model" y="passRate" />
      <Table rows={rows} />
    </Grid>
  );
});

export default defineReport({
  title: "Quality",
  pages: [{ id: "overview", title: "Overview", render: () => <Overview /> }],
});
```

这里的 `sample` 是 Host 交给 Page 或组件的固定 `Sample`。它只能在当前构建中交给 `aggregate()`、`rollup()` 或 `to*`
投影；作者可以排序、筛选和组合返回值，却不能扩大成员范围或改变分母。

中立组件的输入固定而窄：`Table` 接收 `rows`，`Bars`、`Line` 和 `Scatter` 接收 `points`，`Stat` 接收完整
`value`。它们不知道数据来自 Analysis、业务数组还是内建领域视图。

## 闭合值的具体形状

`aggregate()` 的结果是 `ClosedRows`。例如按模型分组后，整组值保留 identity、issues 与 refs；每行仍带完整度量，
而不是一组未包装数字：

```ts
const rows = await aggregate(sample, {
  by: { model },
  values: { passRate },
});

// ClosedRows 可供 Table 和 Bars 同时读取。
// rows.identity: { kind: "closed-rows", id: "…" }
// rows[0]: { model: "terra", passRate: MetricValue }
```

其中一个 `MetricValue` 可以是：

```ts
{
  value: 0.8,
  state: "partial",
  samples: 20,
  total: 25,
  basis: "attempt",
  issues: [{ code: "missing-input", /* … */ }],
  refs: [{ /* Evidence ref */ }],
}
```

`value: 0` 是合法读数。`partial` 仍保留 `20 / 25`、问题和复核链接；组件不能把它变成 `20 / 20`，也不能把
`null` 猜成零。

`ClosedSiteRevision` 是 Host 的内部结果，不是作者返回值。它的具体内容类似下列结构，所有字节都已在构建期确定：

```ts
{
  identity: "sha256:…",
  sampleIdentity: "sha256:…",
  reportIdentity: "sha256:…",
  rendererIdentity: "sha256:…",
  pages: [{ route: "/", bodyBytes: Uint8Array }],
  assets: [{ path: "assets/report.css", bytes: Uint8Array }],
  downloads: [{ path: "downloads/quality.csv", bytes: Uint8Array }],
}
```

identity 是内容寻址值，并且必须包含 Sample、Report 与 renderer identity。它把关闭页面投影、最终 HTML、静态文件和
下载文件绑定为同一版本。

## SSG-first 全站构建

每次 `buildSiteRevision()` 都按相同顺序工作：

1. Host 打开固定 Sample，并加载一个 ReportDefinition。
2. 对每个参数化 Page 恰好调用一次 `params.enumerate(sample)`。
3. 执行全部普通 Page 与全部枚举出的详情 Page，在 Sample 仍可用时关闭组件、计算和下载字节。
4. 对全站 route、链接、下载、问题面、限额和最终字节做全局校验。
5. 形成一个 ClosedSiteRevision，随后关闭 Sample 的读取能力。

Source（源码）、Trace（轨迹）和 Diff（差异）不是客户端按需读取的界面。它们必须在此流程中成为可枚举详情 Page
或站点文件，并由链接指向已经生成的 route 或文件。

Analysis issue 是页面可见的数据事实。它保留在 `MetricValue`、`ClosedRows` 和领域视图中。定义错误、Page 回调失败、
枚举错误、路径冲突或全站校验失败则阻止形成 revision；它们不能留下只完成一部分的站点版本。

## 四个入口，共享同一版本

| 入口 | 在构建完成后做什么 | 不能做什么 |
|---|---|---|
| `niceeval show` | 从闭合页面投影 terminal 文本。 | 为所选 route 再执行作者回调。 |
| `niceeval show --json` | 输出 revision 的固定机器投影。 | 输出下载原始字节或私有事实。 |
| `niceeval view` | 原样托管当前 revision 的 HTML、静态文件和下载文件。 | 在 HTTP 请求、导航或刷新时读取 Analysis。 |
| `niceeval view --out <directory>` | 原样写入当前 revision 的同一批字节。 | 重新呈现页面或只写首个访问过的 route。 |

对任一路由，`view` 返回的 body bytes 与 `view --out` 写入的页面 body bytes 相同。HTTP header、连接和刷新通知不改变
站点正文。断网并禁用 JavaScript 时，正文、导航、详情、问题和下载仍完整可用；刷新通知只是可失效的 Host 增强。

## view 的版本发布

`view` 的 watcher 为每次文件或 Record 变化创建一个 build intent（构建意图）。新的 intent 会中断可中断的旧 candidate
（候选构建），或在旧构建结束后废弃其结果。只有最新 intent 完整成功并通过全站校验，Host 才原子发布新 revision。

失败不会替换 last-good。一个 HTTP request 在开始时固定一个 revision，响应期间不会混入下一次构建的页面、静态文件或下载字节。
refresh transport 只通知浏览器检查新版本；浏览器不因此执行 Analysis、加载 Source、Trace 或 Diff，或改变已服务的响应。

## 性能与固定预算

SSG-first 的代价是每个入口都完整枚举全站，而不是把读取成本推给第一个访问某 route 的浏览器。正确性优先于页面级
缓存和首屏时间。

页面级缓存可以复用已经完全关闭的页面值，但不能复用半开 Sample、回调或读者。其 key 必须同时包含 Sample、Report、
renderer、Page 和 params identity。缓存命中不能改变 Evidence、分母、问题、最终字节或 revision identity。

| 固定预算 | 最大值 | 计数范围 |
|---|---:|---|
| 页面数 | 20,000 | 全部普通 Page 加全部参数实例。 |
| 每页文档节点数 | 20,000 | 每份关闭页面投影。 |
| 每页文档深度 | 32 | 每份关闭页面投影。 |
| 下载文件数 | 1,000 | 一次 revision 的全部下载。 |
| 单个下载字节数 | 33,554,432 | 一个规范化下载文件。 |

这些值限制全站构建可用的内存和枚举范围。Host 在分配无界集合前检查已知数量，并在枚举、关闭节点与收集下载时累计计数。

## 范围与入口

Report 包含作者 DSL、固定 Sample 上的全站构建、关闭页面投影、离线页面文件、下载文件和 view 的版本托管。
Report 不包含 Record 格式、统计口径、浏览器端 Analysis、任意 HTML、可执行脚本、网络依赖或作者可用的文件路径能力。

`head` 只允许非执行 metadata，`<Style>` 只允许 inline CSS。所有本地静态文件都在构建期写入 revision；脚本、worker、
WASM、远程字体和功能性网络请求不进入站点。

- [Library](library.md)：作者调用形状、Page、组件、闭合值与 Host 边界。
- [数值与显示语义](calculations.md)：MetricValue、分母与 ClosedRows。
- [Architecture](architecture.md)：全站 builder、revision、发布和不变量。
- [CLI](cli.md)：每条命令怎样构建并投影同一 revision。
- [Use case](use-case/README.md)：比较、完整度、静态分享与可访问页面。
- [Reference](reference/README.md)：外部材料入口。
