# 站点身份件

`Hero` / `HeroCard` / `PoweredBy` 渲染品牌与站点身份，不是数据投影，形状本身就是契约，
因此不进[内建原语总表](../README.md#内建原语总表)。它们没有宿主特权；
[内建报告](../../library/built-in.md)只是在普通 page 中装配这些公开对象。身份件不收结构子节点。

专属契约见 [`Hero`](hero.md)、[`HeroCard`](hero-card.md)、[`PoweredBy`](powered-by.md)。

## 相关阅读

- [组件树](../README.md) —— 组合规则与共用呈现 props。
- [内建报告](../../library/built-in.md) —— 这些身份件组成默认站点的样子。
- [外壳与多页](../../library/shell.md) —— `ctx.report.title` 的回退链与品牌契约。
- [Sample 页区块](../summaries/README.md) —— 默认站点其余区块的家。
