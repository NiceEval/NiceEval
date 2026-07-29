# `Hero`

`Hero` 显示站点标题、最后运行时间、Run 合成来源与品牌行。
它接 page render 已经投影好的 provenance：

```tsx
<Hero
  title={reportTitle}
  provenance={toSampleProvenance(sample)}
/>
```

```ts
interface HeroProps {
  title: LocalizedText;
  provenance: SampleProvenance;
  className?: string;
}
```

标题回退由内建 page 任务函数完成。
`Hero` 不读取报告外壳、Sample 或运行期 context；
需要站点无关的标题区可以直接使用 [`HeroCard`](hero-card.md)。

## 相关阅读

- [站点组件](README.md)
- [`HeroCard`](hero-card.md)
