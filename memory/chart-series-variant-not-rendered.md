# chart-series-variant-not-rendered

## 现象

`niceeval view` 的横向排行柱状图里，两个不同的 series 显示同一个颜色，完全不可辨。真实复现：MemoryBench Leaderboard（`<Bars color="memory" layout="horizontal">`，五个 memory 值 baseline / mempal / nowledge / obelisk / remem）。baseline 与 obelisk 同为 `#199e70`。

## 根因

页级槽位分配本身正确：`assignSlots` 在 24 槽上散列 + 线性探测，槽位唯一。`seriesChannelsOf` 把槽拆成 `colorIndex = (slot-1)%6+1` 与 `variant`。但官方 Chart 只消费 `colorIndex` 产出 `niceeval-series-cN` 类，**把 variant 通道直接丢掉**；`styles.css` 也没有任何 dash / marker 形状 / 填充图案。于是 24 个视觉身份坍缩成 6 种颜色。

实测这张图：baseline → slot 14 → colorIndex 2，obelisk → slot 20 → colorIndex 2。槽不冲突，但 `14%6 == 20%6`，本该靠 variant 区分的部分没被画出来。

这是 [[scatter-series-color-collision]] → [[report-page-level-color-assignment]] 同一条演进线的第三次：前两次把「同图散列撞色」提升到「页级 24 槽唯一」，但渲染面始终只落颜色一维。docs 早已定稿完整契约（`presentation.md` 的 `FillSeriesPresentation.fill` 可以是 `url(#pattern-id)`，并预言「声明了 series 却没实现 variant 会让 7–12 号身份看起来和 1–6 号一模一样」），官方内建 Chart 自己就是那个状态。

次要出入：旧 `seriesChannelsOf` 的 variant 公式是 `((zero%4 + floor(zero/12)) % 4) + 1`，与 docs 槽序表「1–6 第一变体、7–12 第二变体」不符。

## 修法

按 docs 修代码，不降格文档，不做下游 `dimensionPins` workaround：

1. `seriesChannelsOf` 对齐槽序表：`variant = floor((slot-1)/6) + 1`。
2. `ctx.dimension().at()` 返回 `DimensionPresentation` 家族（label / color / line·scatter·fill series），产出可直接交给 SVG/CSS 的 `fill` / `stroke` / `strokeDasharray` / `marker`；pattern id 为 `niceeval-series-pat-v{2-4}-c{1-6}`，颜色走 `--niceeval-color-series-N`。
3. Chart 三种 mark 与图例都消费呈现值：bar/area 填充图案（SVG `url(#pattern)`；HTML 横向柱用 `niceeval-series-fill-vN` + CSS `repeating-linear-gradient` 等效）、line 的 dash（作者显式 `line` 属性优先于 variant）、scatter/line marker 四种 path。
4. `SeriesPatternDefs` 由 Chart 注入文档；HTML 路径不引用 pattern 但仍挂色类 + 图案类。

落点：`src/report/presentation.ts`、`src/report/assets/series-encoding.ts`、`src/report/definition/primitives/chart.tsx`、`src/report/assets/styles.css`；覆盖在 `src/report/presentation.test.tsx`（含五条件可辨自检）。

## 2026-08-09 浏览器级补修

首轮修复只在呈现值与 DOM 层生效，浏览器最终仍画成纯色。实时 MemoryBench 页面已经给 baseline / obelisk 挂上 `niceeval-series-fill-v3` / `niceeval-series-fill-v4`，但样式表后部的 `.niceeval-chart-bar-fill { background: … }` 与 `.niceeval-chart-legend-swatch { background: … }` 具有相同优先级且声明更晚。`background` shorthand 因此把前面的 `background-image` 重置为 `none`。

原验收只断言两个 `fill` 字符串不同，没有从真实浏览器观察 computed style 或像素结果，所以得到假绿。补修把柱与图例的纯色 `background` 限定为没有 `niceeval-series-fill-v2..v4` 的 variant 1；图案变体继续完整拥有 `background-color`、`background-image` 与 `background-size`。真实验收必须从安装后的报告入口打开 MemoryBench，确认 baseline 与 obelisk 的 computed `background-image` 都不是 `none` 且彼此不同。
