# `Hero`

`Hero` 显示站点标题、最后运行时间、Run 合成来源与品牌行。
它从当前 page 的 `Sample` 计算这些普通值；也可以用 `input` 显式传入另一份 `Sample`：

```tsx
<Hero
  logo={{ src: memoryBenchLogo, alt: "MemoryBench" }}
  description={{
    en: "Does memory help coding agents ship better code?",
    "zh-CN": "记忆能否帮助 coding agent 交付更好的代码？",
  }}
  links={[
    { label: "GitHub", href: "https://github.com/acme/memorybench" },
  ]}
/>
```

```ts
interface HeroProps {
  title?: LocalizedText;
  input?: Sample;
  logo?: HeroLogo;
  description?: LocalizedText;
  links?: readonly HeroLink[];
  className?: string;
}

interface HeroLogo {
  src: string;
  alt: LocalizedText;
}

interface HeroLink {
  label: LocalizedText;
  href: string;
}
```

省略 `title` 时，`Hero` 使用报告标题；省略 `input` 时，使用当前 page 的 `Sample`。
需要站点无关的标题区可以直接使用 [`HeroCard`](hero-card.md)。
 `logo`、`description` 与 `links` 都是可选的品牌内容。
布局、响应式间距、链接体裁与深浅色适配由 Hero 的官方样式负责，报告作者不需要为标准品牌区写页级 CSS。

## 相关阅读

- [站点组件](README.md)
- [`HeroCard`](hero-card.md)
