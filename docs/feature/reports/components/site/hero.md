# `Hero`

`Hero` 在 web 面显示站点标题与品牌行，在 text 面显示已交付的 Sample summary。
它接收明确的 content，不从 page 上下文或 Sample Store 取数：

```tsx
<Hero
  content={summary}
  logo={{ src: memoryBenchLogo, alt: "MemoryBench" }}
  description={{
    default: "Does memory help coding agents ship better code?",
    translations: {
      "zh-CN": "记忆能否帮助 coding agent 交付更好的代码？",
    },
  }}
/>
```

```ts
interface HeroProps {
  readonly title?: LocalizedText;
  readonly content: HeroContent;
  readonly logo?: HeroLogo;
  readonly description?: LocalizedText;
  readonly links?: readonly HeroLink[];
  readonly className?: string;
}
```

`HeroContent`、`HeroLogo` 与 `HeroLink` 的完整形状只在 [HeroCard](hero-card.md) 定义；`LocalizedText` 只在 [Reports Library](../../library.md#通用值文本与参数) 定义。

省略 `title` 时使用报告标题。
布局、响应式间距、链接体裁与深浅色适配由 Hero 的官方样式负责；它们不改变 Sample、coverage 或 evidence。

## 相关阅读

- [站点组件](README.md)
- [`HeroCard`](hero-card.md)
