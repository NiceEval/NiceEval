# `PoweredBy`

唯一的品牌件：无 props 双面组件。web 面渲染指向 niceeval 官网的一行品牌色小字 `Powered by NiceEval`（`https://niceeval.com/?utm_source=report&utm_medium=powered-by`，`rel` 只声明 `noopener` 以保留 Referer）；text 面零输出。它没有任何配置——品牌契约就是「提供一个组件，不给开关」：用 [`Hero`](hero.md) / [`HeroCard`](hero-card.md) / `PoweredBy` 就带品牌行，不想要品牌就不用这些组件、自己写双面组件替代。自定义 hero 想单独摆品牌行时直接放 `<PoweredBy />`。

```tsx
<PoweredBy />
```

## 相关阅读

- [站点组件](README.md) —— 这一族为什么不收结构子节点。
- [`Hero`](hero.md) / [`HeroCard`](hero-card.md) —— 恒含本组件的标题区。
