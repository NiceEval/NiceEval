# Reports 收敛为受限 Source 与双面 Component；公共 CSS 使用完整 NiceEval 前缀

**日期**：2026-07-27

> **本条的模型计数已被 [[report-authoring-three-concept-model]] 推翻**（同日拷问）：
> 「第一层公开模型只有 Source 与 Component」「`defineComposition` 是装配宏」两句不再成立。
> 本条其余裁决（Source 受限输入、双面必填、Issue / Notice 分层、Chart 共用 Dataset、
> CSS 前缀）继续有效。

## 裁决

`Source<Input extends SourceInput, Content>` 只查询 `.niceeval` 的 Sample / AttemptEvidence。
Summary 与 Notice 是对 snapshot / Measure / persisted diagnostics 的产品解释，不是 Source。
`defineComponent` 定义的新渲染形状只消费可序列化 Content，必须提供同步的 `text`
与 `web` renderer，不能另设 `resolve`。Component 只接受互斥的 `source` / `data` 两种形态。

写入、读取与呈现进一步拆开：`.niceeval` 只持久化 Error / Diagnostic observation；Sample 在读取与
选择时产生可重算的 `SampleIssue`；Notice policy 才生成 locale 文案、严重度和 action。Issue 与
diagnostic 都不保存最终用户 message / command，`AttemptError.message` 作为原始失败证据例外保留。
Measure Content 同样不预生成本地化 display，而携带可序列化 `MeasureFormat`，由 renderer 按
`ctx.locale` 格式化。

Chart 不拥有专用 Source。它与 Table 共用 `sources.measure.rows(...)` 的 Dataset，x / y 与
`<Series mark>` 是 Component 呈现声明；这保证 mark、axis、series 不越界进入查询层。

内建原语目录继续保持克制，但这不再等于报告树封闭。内建原语与作者渲染组件使用同一双面协议、
同一 `resolve → validate → collect dimensions → render` 管线和同一主题令牌。组件用
`dimensions(data)` 声明维度全集，用 `ctx.present(dimension, value)` 同时读取完整身份、页内唯一标签
和已消解颜色；自有 React 页面用 `presentDimension(...)`。这个裁决推翻
[[report-components-generic-primitives-ruling]] 中「用户只能扩展数据源与组合组件」的范围限制；
保留「领域名词不能成为增加官方原语的理由」。

公共 CSS 前缀从不透明的 `nre-*` / `--nre-*` 改为完整的 `niceeval-*` / `--niceeval-*`。
报告主题边界是 `.niceeval-report`，颜色令牌使用 `--niceeval-color-*`；series 槽统一为一基编号
`--niceeval-color-series-1..6`。`DimensionPresentation.color` 只公开 `slot` 与可直接用于 CSS 的 `css` 变量引用，
不公开零基 class 名或浅色 hex。

这部分替代 [[theme-as-separate-artifact]] 里的旧 `nre` 令牌命名，不改变主题作为独立制品、
四档装载链、整份选择和 `dimensionPins` 归报告的裁决。

## 曾选方案与否决理由

- **继续封闭报告树，新形状只去自有 React 页面**：否决。主题令牌与页级 `present` 对作者宣称
  可用，却没有能进入 `show` / `view` 的作者 renderer，扩展面不闭合。
- **继续让 `defineComponent` 表示组合宏**：否决。名字承诺组件，实际只能返回其它组件；渲染组件与
  组合宏也需要不同的校验和生命周期。
- **renderer 运行时上报维度值**：否决。前面的组件已经开始渲染后才发现后面的值，无法做
  整页重名与撞色消解。必须在独立 collect dimensions 阶段先收全集。
- **公开 `nre-c0..c5` 与浅色 hex**：否决。缩写不可发现、零基 class 与一基 token 对不上；hex
  绕开浅深主题，class 名又把组件耦合到官方 CSS 结构。

契约落在 `docs/feature/reports/architecture.md`、`components/README.md`、`library/layout.md` 与
`library/theme.md`。
