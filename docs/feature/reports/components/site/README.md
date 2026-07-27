# 站点身份与数据源

这一组包含站点身份件 `Hero` / `HeroCard` / `PoweredBy`。默认站点使用的 `SampleNotices`、
`RunNotices`、`SampleFixPrompt` 等产品组件消费 snapshot 与 persisted diagnostics。
`sources.sample.traces` 是中性的范围级证据 Source。
它们没有宿主特权；[内建报告](../../library/built-in.md)只是在普通 page 中装配这些公开对象。

身份件不收结构子节点；其余对象交给各自匹配的原语。专属契约见
[`Hero`](hero.md)、[`HeroCard`](hero-card.md)、[`PoweredBy`](powered-by.md)、
[`SampleNotices`](sample-warnings.md)、[`RunNotices`](run-diagnostics.md)、
[`SampleFixPrompt`](copy-fix-prompt.md)、[`sources.sample.traces`](trace-waterfall.md)。

## 相关阅读

- [组件树](../README.md) —— 组合规则与共用呈现 props。
- [内建报告](../../library/built-in.md) —— 这些组件组成默认站点的样子。
- [外壳与多页](../../library/shell.md) —— `ctx.report.title` 的回退链与品牌契约。
- [实体列表](../entity-lists/README.md) —— Attempts 页的本体 `sources.entity.attempts`。
- [View](../../view.md) —— attempt 详情路由与导航机器。
- [Sample Library](../../../sample/library.md#issue-code-全集) —— `SampleIssue` 的 code 全集与 Run
  diagnostics 的边界。
