# site SEO:LCP 瓶颈不在字体/图片,审计死链是旧数据

## 现象

2026-07-07 SEO 体检报 62 分:移动端 LCP 3974ms、全站共用 `<title>`、8 处指向 `/docs/quickstart` 的"未爬到内链"、home/blog 各 2 处自链。LCP 直觉怀疑字体或 hero 图,但站点用系统字体、hero 是纯文本 h1,没有一张图。

## 根因

- **LCP**:Lighthouse mobile(simulate)下瓶颈是两段——渲染阻塞的 CSS `<link>`(一次慢网 RTT,FCP 1.7s)+ 启动 JS(script eval 486ms,4x CPU 节流后 ≈2s 压在 LCP 上,大头是 prism-react-renderer + 示例数据和整页一个 chunk)。观测层(无节流)TTFB 20ms、render delay 83ms,页面本身不慢,是关键路径塞了不必要的东西。
- **"未爬到内链"**:`/docs/*` 由 proxy 转发 Mintlify,7-03 (`54d04e0`) 才修通;审计爬取发生在修复前,是旧数据。线上核实全部 200、有 canonical、在 `/docs/sitemap.xml` 里,爬虫 UA 也不被拦。
- **自链**:header 的 logo(home 页)和 Blog 导航(blog 页)链向当前页自身。

## 修法(commit `5f1ba01` + `ec9efef`)

- `next.config.mjs` 开 `experimental.inlineCss`(CSS 仅 ~5KB、首访为主,内联划算);tracker 降 `lazyOnload`;Setup 区块拆 `site-home-setup.tsx` 走 `next/dynamic`(SSR 照常,JS 出关键路径)。效果:prod Lighthouse mobile 82 分→97-100,LCP 3.9s→1.0-2.3s。
- title/hreflang:每页每语言独立 title(`titleHome`/`titleBlog` 进 `site/lib/content.ts`),`alternates.languages` 补 en/zh/x-default。
- 自链:`site-header.tsx` 按 `route` 把当前页的 logo/Blog 渲染成 `span aria-current="page"`,样式靠 `.nav [aria-current="page"]` 兜。
- 适用场景:下次审计再报 `/docs` 死链,先 curl 核实再动手;报 LCP 慢先跑 `npx lighthouse --throttling-method=simulate` 看 `lcp-breakdown-insight` 的 subpart,别按"字体/图片"直觉修。
