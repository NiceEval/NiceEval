# 站点组件

构成一个「完整报告站」的组件：站点标题区（hero）、品牌行、选择警告区、快照诊断区、批量修复 prompt 与 trace 瀑布。它们与其它组件在同一工具箱里，没有任何宿主特权——[内建报告](../../library/built-in.md)的导航 pages 由本页组件加 [`ExperimentComparison`](../summaries/experiment-comparison.md) / [`AttemptList`](../entity-lists/attempt-list.md) 写成，参数化详情页则用 [`AttemptDetail`](../attempt-detail/attempt-detail.md)，任何用户报告都能逐字复刻或整块丢弃。props 组合规则见[组件树](../README.md#数据绑定与两种形态)。

这一族都不收结构子节点：它们的聚合轴、折叠层级与品牌行是契约而不是配置面，作者的取舍在放不放它。

各组件的专属 props 与用法在各自的文件里：[`Hero`](hero.md)、[`HeroCard`](hero-card.md)、[`PoweredBy`](powered-by.md)、[`ScopeWarnings`](scope-warnings.md)、[`SnapshotDiagnostics`](snapshot-diagnostics.md)、[`CopyFixPrompt`](copy-fix-prompt.md)、[`TraceWaterfall`](trace-waterfall.md)。

## 相关阅读

- [组件树](../README.md) —— 组合规则与共用呈现 props。
- [内建报告](../../library/built-in.md) —— 这些组件组成默认站点的样子。
- [外壳与多页](../../library/shell.md) —— `ctx.report.title` 的回退链与品牌契约。
- [实体列表](../entity-lists/README.md) —— Attempts 页的本体 `AttemptList`。
- [View](../../view.md) —— attempt 详情路由与导航机器。
- [Results Library](../../../results/library.md#警告-kind-全集) —— `ScopeWarning` 的 kind 全集与 Snapshot diagnostics 的透传边界。
