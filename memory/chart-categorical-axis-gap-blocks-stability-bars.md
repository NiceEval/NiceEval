# 已修：Chart 分类轴与非 scatter mark 曾让官方图表不可用

- **现象**：`niceeval show --report stability` 里判定构成堆叠柱整块显示 `no data`；
  散点、读数格、矩阵正常。真实 repo(MemoryBench)复现。
- **根因一**：`src/report/definition/primitives/chart-map.ts` 的 `numericFromField` 只认数值。
  dimension 字段的字符串值 `Number()` 不出数就返回 null，整点计入 missing。
  `x="condition"` 的 bar series 因此每个点都缺失。
- **根因二**：四种公开 mark 都进入 `Chart`，但 web renderer 固定过滤
  `mark === "scatter"`。`Line`、`Bars` 与 `Area` 即使通过映射也会输出空图；
  text renderer 则把 bar/area 当坐标点。
- **修法**：`mapChartSeries` 对分类轴按 Dataset 行顺序建立类目索引，并接受内部 Dataset
  的有限 number metric。`Chart` 按 mark 分派 scatter、line、bar、area；
  bar 支持纵向堆叠与横向排行，text 面用横向字符条保留分类、终值和覆盖率。
  多条无 `by` series 也进入页级维度分配，颜色走官方主题。
- **下游验证**：MemoryBench 的自定义排行榜从约两百行双面 renderer 与 CSS
  收缩为 `aggregate()` 加官方 `<Bars layout="horizontal">`。
- **不 hack 的理由**：在组合件里把条件名编码成数字，或让消费方复制官方 CSS，
  都会把显示决定泄漏到数据投影与下游报告；修复必须住在 Chart。
