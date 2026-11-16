# 产品站开发入口

`apps/site/` 是 NiceEval Landing Page。修改页面前先按当前项目依赖理解框架，不使用训练记忆中的 Next.js 约定替代本仓库版本。

当前 Next.js 版本的必读规则由 [`AGENTS.md`](AGENTS.md) 拥有；它是 `next dev` 管理的入口，不在本页复制。

## 视觉

站点以排版和留白建立层级，以位置和明度建立区分，颜色只在有语义时出现。落到站点是四条硬约束：

- **只有暗色。** `app/globals.css` 的 `:root` 是唯一色板。站点不装主题机制，也不做浅色切换，所以令牌写死值、不写 `light-dark()`。
- **零圆角、无渐变、无阴影、无发光。** 盒子只加 1px 边，层次靠 `--panel` / `--panel-2` 两级面色。
- **颜色只表判定。** `--good` 是通过、`--bad` 是失败、`--warn` 是等待；`--accent` 只用来区分身份（例如助手回复），不表示好坏。装饰位一律用 `--soft` / `--muted` 加字重，不借语义色。
- **改色只有一条动线。** 只改 `:root` 的站点色板，并让站点局部样式继续使用这些令牌。

Tailwind 只提供 utility，供 `components/magicui/` 下从 [Magic UI](https://magicui.design) 复制粘贴来的组件用；`globals.css` 只 `@import` theme 与 utilities 两层，不引 preflight——preflight 会重置博客正文的列表符号与标题字重。站点自己的版式仍然全部写在 `globals.css` 的语义 class 里。

## 验证

`/INIT.md` 由 `app/INIT.md/route.ts` 在构建时读取`stable/INIT.md` 并生成静态
Markdown 响应。稳定副本是唯一内容来源；部署不依赖跨目录的 `public` 符号链接。
修改该入口后，启动构建产物并通过 HTTP 检查状态、`Content-Type` 与稳定副本内容一致。

```sh
pnpm run site:build
```

本地开发使用：

```sh
pnpm run site:dev
```

入口会在 `5174` 被其它进程占用时尝试后续端口。同一 checkout 不能同时启动两个开发实例；第二个实例会由 Next.js 基于 `.next/dev` 的 owner lock 明确拒绝，不会删除首个实例的输出。

## 异常监控

产品站使用 Sentry Project `niceeval-landing`，组件为 `site`。客户端、Node 和
Edge 共用发送前白名单；错误正文、请求内容和自由文本 span 属性不发送。
自营产品站的公开 DSN 固定在源码中。正式构建（`NODE_ENV=production`）默认初始化，不需要额外启用变量。
Vercel 使用现有 `VERCEL_ENV` 排除 preview/development；开发和测试默认不发送，
不以域名判断部署归属。

事件环境默认 `production`，可用 `SENTRY_ENVIRONMENT` 覆盖标签，覆盖不影响启用。
构建使用
`SENTRY_RELEASE=site@<git-sha>`；Vercel 未显式提供时从
`VERCEL_GIT_COMMIT_SHA` 生成。浏览器发布与环境由构建配置同步，避免与
服务端和 sourcemap 使用不同标识。显式发布变量默认空。

`SENTRY_AUTH_TOKEN` 只用于部署构建，组织固定 `instaai`。有 token 才上传
sourcemap，并在上传后删除；无 token 的本地构建不上传。上传与生产投递需要
部署后分别验收，构建成功不代表已投递。回滚需回退本轮提交。

本地验收不向 Sentry 发送数据：

```sh
pnpm --filter @niceeval/site exec tsx scripts/check-sentry.ts
pnpm --filter @niceeval/site exec tsc6 --noEmit
pnpm --filter @niceeval/site run build
```

浏览器过滤验收可启动 `node apps/site/scripts/check-sentry-browser.mjs`，在真实
浏览器打开输出地址的 `?mode=off` 与 `?mode=capture`；后者使用真实 React SDK
与本地 transport，覆盖全局异常、嵌套字段和根/子 span。它不替代 Next.js 官方
部署的浏览器、Edge 和 sourcemap 验收。
