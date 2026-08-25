# 产品站开发入口

`apps/site/` 是 NiceEval Landing Page。修改页面前先按当前项目依赖理解框架，不使用训练记忆中的 Next.js 约定替代本仓库版本。

## Site

如果开发 Landing Page 用的是 NextJS
<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may differ from your training data. Read the docs in `node_modules/next/dist/docs/` before coding.
<!-- END:nextjs-agent-rules -->

## 视觉

站点以排版和留白建立层级，以位置和明度建立区分，颜色只在有语义时出现。落到站点是四条硬约束：

- **只有暗色。** `app/globals.css` 的 `:root` 是唯一色板。站点不装主题机制，也不做浅色切换，所以令牌写死值、不写 `light-dark()`。
- **零圆角、无渐变、无阴影、无发光。** 盒子只加 1px 边，层次靠 `--panel` / `--panel-2` 两级面色。
- **颜色只表判定。** `--good` 是通过、`--bad` 是失败、`--warn` 是等待；`--accent` 只用来区分身份（例如助手回复），不表示好坏。装饰位一律用 `--soft` / `--muted` 加字重，不借语义色。
- **改色只有一条动线。** 只改 `:root` 的站点色板，并让站点局部样式继续使用这些令牌。

Tailwind 只提供 utility，供 `components/magicui/` 下从 [Magic UI](https://magicui.design) 复制粘贴来的组件用；`globals.css` 只 `@import` theme 与 utilities 两层，不引 preflight——preflight 会重置博客正文的列表符号与标题字重。站点自己的版式仍然全部写在 `globals.css` 的语义 class 里。

## 验证

```sh
pnpm run site:build
```

本地开发使用：

```sh
pnpm run site:dev
```
