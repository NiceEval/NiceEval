# 发现(未修):Chart 无分类轴,stability 视图的判定堆叠柱渲染成 no data

- **现象**：`niceeval show --report stability` 里判定构成堆叠柱整块显示 `no data`；
  散点、读数格、矩阵正常。真实 repo(MemoryBench)复现。
- **根因**：`src/report/definition/primitives/chart-map.ts` 的 `numericFromField` 只认数值——
  dimension 字段的字符串值 `Number()` 不出数就返回 null,整点计入 missing。所以
  `x="condition"`(条件名当横轴)的 bar series 每个点都缺失。bar 契约
  (docs/feature/reports/components/charts/bar-chart.md 的排行/分组/堆叠)先行于实现,
  分类轴映射与两面柱渲染还没落。
- **修法(待做,归 chart 工作线)**：mapChartSeries 给 dimension×string 的轴按稳定序建
  类目→索引映射,text/web 两面按类目刻度渲染;stack 聚合同 stack key 的 y。
  StabilityOverview 侧不需要改——投影数据已按契约就位(有单测),分类轴落地即点亮。
- **不 hack 的理由**：在组合件里把条件名编码成数字会把「显示决定不进 Source/投影」的边界
  打穿,且 chart.tsx 正被主题/类名工作线活跃修改,不跨线动它。
