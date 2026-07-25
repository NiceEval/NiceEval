# `HeroCard`

[`Hero`](hero.md) 的渲染件，双面组件，只收 data 形态——它的标题输入是站点声明与 Scope 的合成物，没有单独的 spec 等价形，所以不设 spec 形态：

```ts
interface HeroData {
  /** Scope 中最新快照的开始时间；空 Scope 为 null，不编造当前时间。 */
  latestStartedAt: string | null;
  /** 贡献当前水位的快照数；大于 1 时 web 面标注「由 N 次运行合成」。 */
  snapshots: number;
}

function heroData(input: ReportInput): Promise<HeroData>;

interface HeroCardProps {
  title: LocalizedText;
  data: HeroData;
  className?: string;
}
```

web 面渲染 hero 标题（`<h1>`）、meta 行（最后运行时间按渲染 locale 格式化；`latestStartedAt` 为 null 时显示内置「暂无运行」文案）与品牌行（等同 [`PoweredBy`](powered-by.md)，恒含、无拆除 prop）；text 面输出标题行与 meta 行，不含品牌行。`niceeval/report/react` 导出同名纯组件，web 行为一致——品牌跟着组件走，不区分官方宿主与嵌入页面。

## 相关阅读

- [站点组件](README.md) —— 这一族为什么不收结构子节点。
- [`Hero`](hero.md) —— 跟随站点声明的组合组件。
- [`PoweredBy`](powered-by.md) —— 本组件恒含的品牌行。
