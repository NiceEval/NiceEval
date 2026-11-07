# Vercel 站点域名和 docs routing 容易分裂

## 现象

2026-07-03 线上站点 `https://www.niceeval.com/` 直接返回 Vercel `404 NOT_FOUND`。
同一时间 GitHub push 触发的 `fastevals` project deployment 已经是 Ready，`fastevals-*.vercel.app`
能正常构建，但自定义域 `niceeval.com` / `www.niceeval.com` 仍然挂。

第二层问题是 `https://www.niceeval.com/docs/quickstart` 会被站点的 locale proxy 改写成
`/en/docs/quickstart`，绕过 `vercel.json` 里的外部 Mintlify rewrite，最后 404。

## 根因

这次站点曾同时存在两个 Vercel project：

- `fastevals`：当前 repo 链接的项目，最新 deployment 是实际可用站点。
- `niceeval`：旧项目，仍绑定 `niceeval.com` / `www.niceeval.com` domain。Vercel 会继续为旧项目部署
  `niceeval-*.vercel.app`，而这些 deployment 没有正确 serving 当前站点，所以自定义域 404。

只跑 `vercel alias set <fastevals-deployment> www.niceeval.com` 不够；如果 domain 级别仍关联旧 project，
Vercel 可能又把 production domain 解析回旧项目的 `niceeval-*` deployment。要看：

```bash
npx vercel domains inspect niceeval.com
npx vercel alias ls | rg 'niceeval.com|fastevals-'
```

`site/proxy.ts` 的 matcher 原来匹配所有无扩展名路径，包含 `/docs/...`。Next proxy 先执行，把 `/docs/quickstart`
重定向为 `/<locale>/docs/quickstart`，因此 Vercel 的 `/docs` rewrite 没机会代理到 Mintlify。

另外，Vercel build 的 `outputDirectory` 如果还继承 dashboard 里的旧 `dist` 设置，`pnpm run site:build`
虽然成功，最后也会报：

```text
Error: No Output Directory named "dist" found after the Build completed.
```

因为 Next 实际产物在 `site/.next`。

## 修法

1. 在 `vercel.json` 显式写：

```json
"outputDirectory": "site/.next"
```

2. 让 `site/proxy.ts` 的 matcher 排除 docs：

```ts
matcher: ["/((?!_next|docs|.*\\..*).*)"],
```

3. 把 domain 级别从旧 project 迁到当前 project，而不是只 alias：

```bash
npx vercel domains add niceeval.com fastevals --force
npx vercel alias remove www.niceeval.com --yes
npx vercel domains add www.niceeval.com fastevals --force
npx vercel alias set <latest-fastevals-deployment>.vercel.app www.niceeval.com
```

4. 验证必须同时检查主页、语言页和 docs：

```bash
curl -I -L https://www.niceeval.com/
curl -I -L https://niceeval.com/
curl -I -L https://www.niceeval.com/en
curl -I -L https://www.niceeval.com/zh
curl -I -L https://www.niceeval.com/docs/quickstart
```

期望主页 `/` 307 到 `/en` 后 200，`/en` / `/zh` 直接 200，`/docs/quickstart` 由 Mintlify 返回 200。
