# TanStack Table / Charts

> 观察日期：2026-08-14
>
> 研究对象：TanStack Table 9.1.2 与 TanStack Charts 0.12.0
>
> 文档性质：外部产品研究与产品建议，不是 NiceEval 目标契约

## 产品是什么

TanStack Table 是 headless table / data-grid engine。
应用提供 columns、data、feature set 与可选 state；Table 返回 table instance、row / column / header / cell 对象和派生 row models。
最终 markup、样式、数据获取与应用持久化不属于 Table。

TanStack Charts 是 framework-agnostic TypeScript visualization grammar。
应用用 marks、channels、scales、guides 与交互选项声明图表；Charts 把 definition 编译成 renderer-neutral keyed scene，再交给 SVG、Canvas 或 custom renderer。

两者都是嵌入应用的库，不是一体化的实验、观测或报告平台。
Table 解决“当前 rows 怎样成为可交互表格视图”，Charts 解决“当前 data 怎样成为可渲染 scene”。

## 用户心智模型

### TanStack Table

```text
columns + data + features + state
                ↓
          table instance
                ↓
core → filter → group → sort → expand → paginate
                ↓
             RowModel
                ↓
       application-owned markup
```

官方 [Overview](https://tanstack.com/table/latest/docs/overview) 把 Table 定义为 headless core。
官方 [Row Models Guide](https://tanstack.com/table/latest/docs/guide/row-models) 把各阶段定义为当前 rows 的派生链。

### TanStack Charts

```text
data + marks + channels + scales + guides
                    ↓
              ChartDefinition
                    ↓
 channels → scales → guide layout → marks
                    ↓
                ChartScene
                    ↓
       SVG / Canvas / custom renderer
```

官方 [Overview](https://tanstack.com/charts/latest/docs/overview) 把产品称为 visualization grammar。
官方 [Runtime and Scene](https://tanstack.com/charts/latest/docs/reference/runtime-and-scene) 定义了 definition → scene → renderer 的顺序。

## 原生对象总图

| 产品 | 原生对象 / component | 产品内责任 |
|---|---|---|
| Table | `tableFeatures()` | 组合 feature、row-model factory 与算法 registry |
| Table | `TableOptions` | 接收 columns、data、state、atoms 与 feature set |
| Table | `Table` | 协调状态、对象 API 与 row models |
| Table | `TableState<TFeatures>` | 表示当前交互视图的 feature-gated state slices |
| Table | `RowModel` | 提供当前阶段的 `rows`、`flatRows`、`rowsById` |
| Table | framework adapter | 把 core state 接入 React、Vue、Solid 等框架 |
| Charts | mark / channel / scale / guide | 声明数据的视觉编码与坐标语义 |
| Charts | `ChartDefinition` | 保存 static spec 或 responsive builder |
| Charts | `ChartRuntime` | 用当前 definition、size 与 layout 编译 scene |
| Charts | `ChartScene` | 保存当前 renderer-neutral nodes、points、scales 与 theme |
| Charts | `ChartRenderer` / `ChartSurface` | 把 scene 投影到具体媒介 |
| Charts | `ChartHost` | 管理 mount、update、resize、interaction 与 destroy |
| Charts | export functions | 把当前 scene / surface 投影成 SVG 或 bitmap |

Table 的固定源码入口是官方 commit
[`d003d72879a49e3713cf22bcaa10d8784c1d5afe`](https://github.com/TanStack/table/commit/d003d72879a49e3713cf22bcaa10d8784c1d5afe)。
Charts 的固定源码入口是官方 commit
[`db68561e55d608cd9101843615d55757a3c4adbc`](https://github.com/TanStack/charts/commit/db68561e55d608cd9101843615d55757a3c4adbc)。

## 研究页导航

- [Record → Report 适格性审查](eligibility.md)：核对运行、写入、失败、持久结构、历史读取、比较、version 与 migration，并说明移出方向。

## 与 NiceEval 的相似点与差异

这是研究者推论，不改变前述 TanStack 产品模型。

相似点是两者都先形成语义派生值，再交给 renderer；stable identity、浏览状态与 cache 也不会反向成为 source data。
这可约束 NiceEval 的 Table / Chart 呈现内核。

根本差异是 TanStack 不拥有 Run、Attempt、评价或 Evidence，也不保存、重开或迁移历史结果。
NiceEval 的 Record、Sample、denominator、coverage、missing 与证据引用不能交给通用 row model 或 chart scene 决定。

因此应吸收 renderer 边界，而不应把 `RowModel` 或 `ChartScene` 当成 NiceEval 的 durable schema。
