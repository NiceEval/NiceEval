# 报告显示值定稿为计算侧单点格式化,否决 MeasureFormat

**裁决(2026-07-28)**:报告读数的显示字符串在计算侧生成一次,写进 `MeasureCell.display:
LocalizedText`,渲染面只按 locale 取语言、不重算。格式由 `Measure.unit` 驱动(`%` / `ms` /
`$` / 其它 unit 缩写加单位 / 无 unit 纯缩写),`Measure.display` 是覆盖单个终值的钩子函数。
计算侧唯一入口是 `measureDisplay()`,渲染侧唯一入口是 `formatCellText()`。

**曾选方案**:`MeasureFormat`(`{ style: "number" | "percent" | "currency" | "duration" |
"tokens"; currency?; minimumFractionDigits?; maximumFractionDigits? }`)随字段或 cell 序列化,
renderer 用 `ctx.locale` 执行格式化。`measures.md` 曾明文禁止 `(value, locale) => string`
回调与「compute 阶段生成 `LocalizedText`」,理由是开放 BCP 47 locale 无法穷举。

**否决理由**:

- 这个类型在仓库里只有 `types.ts` 的定义和 `index.ts` 的导出两处,一个消费者都没有——
  真实实现走的一直是 `unit` + 计算侧 `display`,文档描述的是另一套不存在的机制。
- 两个渲染面必须逐字相同。格式化留在渲染面就有两份实现,text 面和 web 面迟早分叉。
- 开放 locale 那条理由被 `LocalizedText` 回退链解决:生成面覆盖 en / zh-CN,两者相同时
  折成单个字符串,其它 locale 回退 en。JSON 因此自足,不需要消费方带格式化器。

**同场裁决**:取实验颜色只有 `ctx.dimension()` 与 `presentDimension()` 两个入口。
`assets/colors.ts` 的 `SERIES_PALETTE` / `colorIndexForKey` / `colorClassForKey` /
`colorHexForKey` / `seriesClassForKey` 退回内部实现,不在任何公开入口上——它们做的正是
`使用主题色.md` 明令禁止的三件事(按下标取色、拼公开 class 名、读浅色 hex)。

**起因**:分组行的 tokens 显示成裸 `46500` 而不是 `46.5k tokens`(`content.ts` 的
`meanCells` 没传 unit,落到 `String(value)` 分支)。同一个 commit 刚把 attempt 行的
`String(item.durationMs)` 修成格式化,组行又开了同类口子。根因是公开面根本没有格式化函数,
Content 层作者手边只有 `String(value)`,一处修好不影响下一处。

**落点**:契约在 `docs/feature/reports/library/presentation.md`(新页,公开函数总表);
`measures.md` 删 `MeasureFormat`、改写 `MeasureCell`;`table.md` 的单元格渲染表改成读
`display`;测试类别声明在 `docs/engineering/testing/unit/reports.md`「显示值单点」。
