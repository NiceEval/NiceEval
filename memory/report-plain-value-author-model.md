# Reports 作者模型翻案：plain-value page.render 取代 Source/Composition

**日期**：2026-07-29

## 裁决

报告作者模型改为 **plain-value**：page `render` 接收 `Sample` 或 `AttemptEvidence`，
用普通 TypeScript 函数（`aggregate()`、`rollup()`、公开 `to*`）算出可序列化值，
组件只消费 `rows`、`points`、`items`、`nodes`、`content` 等具体 props。

`defineSource` / `defineComposition` / `ctx.resolve()` / 组件 `data=` 双形态从公开面删除。
异步与 artifact 读取发生在 page render，不增加 Composition 编排层。
自定义显示形状走 `defineRenderer`（`niceeval/report/extension`），只接已算好的 `value`。

## 曾选方案与否决理由

- **Source / Composition / Component 三概念**（[[report-authoring-three-concept-model]]，2026-07-27）：
  否决。Composition 是「取多个 Source 再 join」的唯一合法 `await` 产地，但把取数藏在
  resolve 管线里，作者要在 spec/data 双形态与 `ctx.resolve` 之间跳转；公开教程与内建报告
  都更适合「先算值、再 `<Table rows={rows}>`」的普通 TypeScript 数据流。
- **保留 Composition、只删 Source**：否决。没有 Source 就没有 `ctx.resolve` 的缓存语义，
  Composition 退化成「能 await 的 JSX 宏」，不如直接把 `await` 写进 page render。

## 后续清理（同日）

- `defineMeasure` / `metric-views/**` / `src/report/sources.ts` 已删；
  见 [report-metric-views-deleted](report-metric-views-deleted.md)。
- 仍内部保留：`ResolveMemo`（树解析）、`report/slices`（show 对照/稳定性）、
  entity-lists Content 适配路径。
