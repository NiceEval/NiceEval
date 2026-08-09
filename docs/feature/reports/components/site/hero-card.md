# `HeroCard`

[`Hero`](hero.md) 使用的站点身份原语。
它只收已经生成的 Sample summary；标题由调用者显式传入。

```ts
interface HeroLogo {
  readonly src: string;
  readonly alt: string;
}

interface HeroLink {
  readonly label: LocalizedText;
  readonly href: string;
}

interface HeroContent {
  readonly sample: SampleRef;
  readonly membershipCount: number;
  readonly coverage: MetricCoverage;
}

interface HeroCardProps {
  readonly title: LocalizedText;
  readonly content: HeroContent;
  readonly logo?: HeroLogo;
  readonly description?: LocalizedText;
  readonly links?: readonly HeroLink[];
  readonly className?: string;
}
```

`HeroLogo`、`HeroLink`、`HeroContent` 与 `HeroCardProps` 的唯一 owner 是本页。
`SampleRef` 来自 [Sample Library](../../../sample/library.md#选择器source-集合与-sampleref)。
`MetricCoverage` 来自 [Reports Library](../../library.md#分组函数与计算函数)；`LocalizedText` 来自 [Reports Library](../../library.md#通用值文本与参数)。

web 面依次渲染可选 logo、标题、介绍、链接与品牌行。
text 面显示同一份 Sample identity、成员数与 coverage；它不读取当前时间，也不重新打开 Record。

## 相关阅读

- [站点组件](README.md) —— 这一族为什么不收结构子节点。
- [`Hero`](hero.md) —— 跟随站点声明的组合组件。
- [`PoweredBy`](powered-by.md) —— 本组件恒含的品牌行。
