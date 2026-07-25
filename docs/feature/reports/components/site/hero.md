# `Hero`

页首的站点标题区：标题、最后运行时间、快照合成来源，恒含品牌行。它是官方组合组件（与 [`FailureList`](../entity-lists/failure-list.md) 同族的成品，没有私有能力）：标题缺省取 `ctx.report.title`——规范化声明里走完回退链（`def.title` → 唯一快照 `name` → 内置文案）的站点标题，与浏览器标题同源；运行 meta 取自宿主注入的 Scope。内部严格等价于手写组合：

```tsx
const Hero = defineComponent(async ({ title, className }: HeroProps, ctx) => (
  <HeroCard title={title ?? ctx.report.title} data={await heroData(ctx.scope)} className={className} />
));
```

```ts
interface HeroProps {
  /** 覆盖标题；省略时取 ctx.report.title（回退链后的站点标题）。 */
  title?: LocalizedText;
  className?: string;
}
```

```tsx
<Hero />                          // 标题跟随站点声明
<Hero title="Memory Evals" />     // 显式标题
```

读 `ctx.report` 意味着 `Hero` 的输出跟随站点（[契约](../../library/shell.md#行为约束)）；要站点无关的标题区，直接用 [`HeroCard`](hero-card.md) 显式传值。

## 相关阅读

- [站点组件](README.md) —— 这一族为什么不收结构子节点。
- [`HeroCard`](hero-card.md) —— 本组件的渲染件。
