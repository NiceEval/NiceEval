# `HeroCard`

[`Hero`](hero.md) 使用的站点身份原语。
它只收已经算好的 Sample 来源摘要；标题由调用者显式传入。

```ts
interface HeroContent {
  /** Sample 中最新 Run 的开始时间；空 Sample 为 null，不编造当前时间。 */
  latestStartedAt: string | null;
  /** 构成当前结果集的 Run 数；大于 1 时 web 面标注「由 N 次运行合成」。 */
  runs: number;
}

interface HeroCardProps {
  title: LocalizedText;
  data: HeroContent;
  logo?: HeroLogo;
  description?: LocalizedText;
  links?: readonly HeroLink[];
  className?: string;
}
```

`HeroLogo` 与 `HeroLink` 的形状见 [`Hero`](hero.md)。
web 面依次渲染可选 logo、hero 标题（`<h1>`）、可选介绍、可选链接组与品牌行，不显示运行 meta。
text 面输出标题、可选介绍、可选链接与 meta，不含纯视觉 logo 和品牌行。最后运行时间按 text 面的 locale 格式化；`latestStartedAt` 为 null 时显示内置「暂无运行」文案。
`niceeval/report/react` 导出同名纯组件，web 行为一致——品牌跟着组件走，不区分官方宿主与嵌入页面。

## 相关阅读

- [站点组件](README.md) —— 这一族为什么不收结构子节点。
- [`Hero`](hero.md) —— 跟随站点声明的组合组件。
- [`PoweredBy`](powered-by.md) —— 本组件恒含的品牌行。
