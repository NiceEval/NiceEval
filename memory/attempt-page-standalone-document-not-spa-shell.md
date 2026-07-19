---
name: attempt-page-standalone-document-not-spa-shell
description: 已修——attempt/<locator>.html 不能复用 index.html 的 SPA 外壳(空 #root 等 JS 挂载),无 JS 会白屏;改造过程中也发现相对路径与 locator 编码两处会在真实静态托管下断链的隐患
metadata:
  type: project
---

Phase F(`view` 为每个可达 locator 产出 `attempt/<locator>.html`)最初打算直接复用 `renderHtml`/
`template.html`(index.html 的 SPA 外壳):双语内容都烘成 `<template>` 静态块,`#root` 起初为空,
等 React(`main.tsx`)挂载后才把对应语言的块塞进去。这个模式对 index.html 没问题(那是一个有 tab
路由的 App),但直接搬到 attempt 页面上会违反 view.md「静态导出」明确写的不变量——「基线 locator
链接直接指向 `attempt/<locator>.html`,保证无 JavaScript 也能读完整详情」:`<template>` 内容在没有
JS 的浏览器里天生不渲染,复用这个模式会让 attempt 页面在关闭 JS 时整页空白,直接违反契约。

# 修法

不复用 SPA 外壳,给 attempt 页面写一个独立的轻量渲染器(`site.ts` 的 `renderAttemptDocument`)。
关键结构差异:两种语言内容都直接落成可见 DOM(不进 `<template>`),但用一个属性区分——
`<div data-nre-locale="en">`(可见)与 `<div data-nre-locale="zh-CN" hidden>`(`hidden` 属性,
浏览器原生渲染指令,不需要 JS 就能正确隐藏)。一段几行的内联 vanilla 脚本按检测到的界面语言在两者
间切换(逻辑照抄 `app/i18n.ts` 的 `detectLocale()`,但不拉入 react/react-dom——独立文档没有理由
背上整个 SPA 打包产物)。增强脚本(index.html 里拦截 locator 链接、fetch 这份文档塞进 dialog 的那段)
按同一个 `[data-nre-locale]` 选择器取内容,不维护第二份提取逻辑。

# 同一轮改造中,advisor 提前指出的两处隐患(不是事后调试,是设计阶段挡下来的)

1. **相对路径深度**:`attempt/<locator>.html` 比 `index.html` 深一层。`materializeHeadAssets`
   物化的本地 head 资产(`assets/<sha256><ext>`)原来是根相对路径,直接用在 attempt 页面上会解析成
   `attempt/assets/...`(不存在)。修法:给 `materializeHeadAssets` 加 `prefix` 参数,index.html 传
   `""`,attempt 文档传 `"../"`;物化本身只做一次(按内容哈希去重),两个前缀版本共享同一份已写入的
   文件,只是引用字符串不同。用真实的 `python3 -m http.server`(哑静态托管,不经 `server.ts` 的
   decode/manifest 查找)加一个声明本地 favicon 的自定义报告验证过:`index.html` 里是
   `href="assets/<hash>.svg"`,`attempt/<locator>.html` 里是 `href="../assets/<hash>.svg"`,两条
   路径在真实 HTTP 请求下都能拿到 200。
2. **编码/解码边界**:`server.ts` 已有的通用路径分发对 `pathname` 做一次 `decodeURIComponent`。
   如果站点清单的 key 用 `encodeURIComponent(locator)`(含 `%40`),`plan.files.get()` 会因为
   decode 之后的字符串对不上而找不到文件。修法:磁盘文件名 / 清单 key 恒用未编码的原始 locator
   (含字面 `@`,文件系统对 `@` 没有任何限制);只有 HTML 里的 `href` 字符串用
   `encodeURIComponent(locator)`——两者靠「href 会被浏览器/静态服务器解码回原始路径再查找文件」
   这条通用 web 惯例天然对上,不需要两边约定一致的转换表。

这两处都是「组件级/合成级测试测不出来,必须让更真实的一层验证」的又一次重复(同一方法论已经在
[attempt-detail-component-level-green-composite-broken](attempt-detail-component-level-green-composite-broken.md)
与
[attempt-faces-free-text-needs-summarytext-bounding](attempt-faces-free-text-needs-summarytext-bounding.md)
出现过两次)——但这次是在写代码前的设计讨论阶段被系统性地问出来的,不是等真实环境跑出 bug 才发现。
`server.ts` 自己的 `decodeURIComponent` 步骤会把两者的不匹配悄悄"修好"(内部一致但偶然),真正会
炸的是脱离 `server.ts` 的路径——静态导出后拿真实静态服务器(nginx/GitHub Pages/`python3 -m
http.server`)直接托管,或者用 `file://` 打开——这些路径必须单独验证一次,不能只信 `server.ts` 自己
测出的绿。

# How to apply

以后任何往 view 站点新增「不在站点根、独立于 index.html 之外的文档」的功能,进设计前先问两个问题:
(a) 这份文档里引用的相对资源(样式、脚本、其它文档)是否假设了「我在站点根」?(b) 磁盘文件名 /
服务器路由 key / HTML 里的 href 字符串,三者的编码状态是否一致?两个答案都要靠**脱离本仓库
`server.ts` 的真实静态托管**验证,不能只跑 vitest 里的 `server.ts` 集成测试。
