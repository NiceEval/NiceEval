# 站点身份与数据源

这一组包含站点身份件 `Hero` / `HeroCard` / `PoweredBy`，以及默认站点会使用的
`sampleProvenance`、`sampleWarnings`、`runDiagnostics`、`fixPrompt`、`traceRows` 数据源。
它们没有宿主特权；[内建报告](../../library/built-in.md)只是在普通 page 中装配这些公开对象。

身份件不收结构子节点；其余对象交给各自匹配的原语。专属契约见
[`Hero`](hero.md)、[`HeroCard`](hero-card.md)、[`PoweredBy`](powered-by.md)、
[`sampleWarnings`](sample-warnings.md)、[`runDiagnostics`](run-diagnostics.md)、
[`fixPrompt`](copy-fix-prompt.md)、[`traceRows`](trace-waterfall.md)。

## 相关阅读

- [组件树](../README.md) —— 组合规则与共用呈现 props。
- [内建报告](../../library/built-in.md) —— 这些组件组成默认站点的样子。
- [外壳与多页](../../library/shell.md) —— `ctx.report.title` 的回退链与品牌契约。
- [实体列表](../entity-lists/README.md) —— Attempts 页的本体 `attemptRows`。
- [View](../../view.md) —— attempt 详情路由与导航机器。
- [Sample Library](../../../sample/library.md#警告-kind-全集) —— `SampleWarning` 的 kind 全集与 Run diagnostics 的透传边界。
