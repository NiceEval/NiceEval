# site/ 接 Tailwind + Magic UI 的两个坑

**日期**:2026-07-29
**适用**:`site/` 从手写 `globals.css` 起家,要引入 shadcn / Magic UI 那类复制粘贴组件时。

## 现象一:preflight 把博客正文吃掉

按 Next 官方文档接 Tailwind v4(`@tailwindcss/postcss` + `@import "tailwindcss"`)后,
博客文章页的无序列表符号消失、正文标题字重被压平。首页看不出问题——首页每个元素都有
自己的语义 class,而博客正文是 MDX 解析出的裸 `ul` / `li` / `h2`。

**根因**:`@import "tailwindcss"` 会带上 preflight(base 层),它把 `ul` 的 `list-style`
清成 `none`、把标题的 `font-size` / `font-weight` 归成 `inherit`。站点自己的 CSS 只给
`.article-body ul` 写了 `padding-left`,没有重新声明 `list-style`,于是被静默重置。

**修法**:只导入 theme 与 utilities 两层,不要 preflight:

```css
@layer theme, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities) source("../");
```

`source("../")` 把源码扫描范围钉在 `site/`,不让它顺着仓库根往外爬。顺带一个好处:
unlayered 的手写 CSS 天然赢过 layered 的 utility,两套样式的优先级不用再猜。

## 现象二:AnimatedSpan 的 `grid` 把终端一行拆成三行

Magic UI Terminal 的 `AnimatedSpan` 默认带 `grid text-sm tracking-tight`。把
`<b class="fail">✗</b> @1qrdcfq8 image-understanding <span>· 运行 eval</span>`
这种一行多片段的内容放进去,渲染成三行——每段连续的行内内容被 grid 各自包成一个匿名
grid item,一格一行。字号也被 `text-sm` 钉死,跟终端的 12.5px 对不上。

**根因**:复制粘贴组件自带观感,而这套观感是给它自己的 demo 调的。

**修法**:复制进来的组件只留结构与行为,`display` / 字号 / 字距这类交给站点的
`.term-*` class(改在 `site/components/magicui/terminal.tsx`)。同理,macOS 圆角窗口与
红黄绿三点也在这一步换掉——`cn()` 合并 class 只能覆盖 utility,覆盖不了标记本身。

## 相关

- 站点视觉的四条硬约束写在 `site/README.md`「视觉」,总纲在根 `DESIGN.md`。
- 终端 hero 的动效分层:挂载时机仍由组件自己的 rAF 时间轴决定(live 面板要被摘要面板
  顶替,不是纯追加),Magic UI 只负责打字与淡入。
