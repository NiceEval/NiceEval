---
format: concord.document/v1
id: view-client-fetch-machinery-fully-removed
title: view-client-fetch-machinery-fully-removed
createdAt: 2026-07-19T17:49:52+08:00
createdAtSource:
  kind: first-recorded
  path: memory/view-client-fetch-machinery-fully-removed.md
  commit: 421474faf4b046d33e385953e4f269d45944eb42
description: Phase F 收尾——AttemptModal/CodeView/Trace/Transcript 等整棵客户端手渲染树连同 viewData.snapshots 一起删除,attempt 详情改成 fetch 独立文档塞进 dialog;记录判断"什么算真死"的依据(遗留的两处 cases.md 陈旧行已在 Phase H 处理完)
kind: memory
memoryKind: problem
state: resolved
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "- 已修 [view-client-fetch-machinery-fully-removed](view-client-fetch-machinery-fully-removed.md) — Phase F 收尾:AttemptModal/CodeView/Trace/Transcript 整棵客户端手渲染树 + viewData.snapshots 一起删除,attempt 详情改 fetch 独立文档塞 dialog;记录判活依据、无浏览器环境下的验证手法;遗留的 cases.md 陈旧行已在 Phase H 处理(第 218 行删除,198/220 行复核后判定无需改)"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---

Phase F 前两次提交(`attempt/<locator>.html` 静态文档 + 本地 server 越过收窄解析)落地后,
`src/view/app/` 里整棵旧的客户端手渲染树——`AttemptModal.tsx`/`CodeView.tsx`/`Trace.tsx`/
`Transcript.tsx`/`CopyControls.tsx`/`ui/badge.tsx` 与它们各自的 `lib/`(`artifact-url.ts`/
`guards.ts`/`transcript-data.tsx`/`verdict.ts`/`rows.ts`/`attempt-route.ts`/`format.ts`/
`shared.ts`)——连同它们唯一的数据来源 `ViewData.snapshots`(`ViewSnapshot`/`ViewEvalResult`
两个类型)一起删除。`App.tsx` 新增的 attempt dialog 只做两件事:拦截 `attempt/<locator>.html`
链接点击、fetch 该文档解析出两种语言片段塞进 Radix Dialog——不再有任何客户端侧的"根据
`ViewResult` 字段手拼断言行/时间树/transcript"逻辑。

# 判断"真死"的依据(不是猜的,是逐个 grep 验证的)

删除前逐个 grep 确认没有除彼此外的导入者:`CodeView`/`Trace`/`Transcript`/`CopyControls`/
`ui/badge` 只互相导入,`app/lib/` 下那几个只被这棵树导入。`viewData.snapshots` 的删除额外
验证了：`data.ts`(server 侧生产者)之外只有 `App.tsx` 的旧 `modalResultFromLocation`/
`resultFromUrl` 路径读它——新 dialog 逻辑完全不需要"扫描全部快照按 id 找回 attempt"这件事
(直接用 locator 拼 href 去 fetch),所以这条数据通道整个变成死重(每份导出 HTML 都白白
多背一份序列化的 attempt 明细)。`AttemptList`/`TraceWaterfall`(内建 Attempts/Traces 页)
不读这份数据——它们是走标准 resolve 管线的报告组件,数据来自 Scope,不是 viewData。

# 修法

- `src/view/shared/types.ts`:删掉 `ViewSnapshot`/`ViewEvalResult`,`ViewData.snapshots` 字段整个去掉。
- `src/view/data.ts`:`annotateResult` 改名 `artifactLocation`,只算 `{base, abs}`,不再拼
  `ViewEvalResult`;原先按 snapshot 分组构建 `ViewSnapshot[]` 的双层循环压平成一次遍历
  `dedupeAttempts(...).attempts`,直接填 `artifactDirs`/`attemptsByBase`/`attemptsByLocator`
  三个索引(这三个都不序列化进 viewData,只服务证据室的服务端计算,client 不消费)。
  连带清掉只为 `ViewSnapshot.latest` 服务的 `latestPerExperiment`/`latestSet` 与
  `basename` import。
- `src/view/app/lib/attempt-dialog.ts`(新):`attemptHrefFor`/`attemptLocatorFromHref`/
  `hashForAttempt`/`locatorFromHash`/`parseAttemptDocument`——后者是纯字符串切分(找
  `data-nre-locale="en"`/`"zh-CN"` 两个标记之间的内容),不用 DOMParser,因为文档结构是
  `site.ts` 自己产出的固定形状,不需要通用 HTML 解析。
- `App.tsx`:`useEffect` 里挂一个 document 级 click 监听器,拦截 `href` 匹配
  `attempt/<encoded>.html` 形状的 `<a>`,`preventDefault` 后改写 `location.hash`,交给
  已有的 hashchange 处理器统一 fetch+打开——点击、浏览器前进/后退、直接携带 hash 打开页面
  三条路径收敛成一条,不重复实现打开逻辑。
- CSS(`src/view/styles.css`):对着幸存 tsx 文件(`App.tsx`/`ui/tabs.tsx`/`ui/dialog.tsx`)
  实际用到的 className 逐个核对,砍掉整段 modal/codeview/trace/transcript/assert/
  phase-timing 规则(958 行砍到 ~160 行);client 打包体积 CSS 从 41.7kB 降到 12.9kB
  (gzip 8.1kB → 3.8kB),JS 从 268kB 降到 264kB(react/react-dom 仍在,减量不大,大头是
  手写组件树本身,不是依赖)。

# 如何验证(没有真实浏览器,靠什么确认 dialog 真的能用)

这个仓库没有 Playwright/Puppeteer。验证靠一段一次性脚本(不进仓库,scratchpad):真实
`createResultsWriter` 落一份带失败断言的快照,`startViewServer` 起服务,`fetch` 首页拿到
真实 index.html,用正则从里面抠出一条 `attempt/%40....html` 链接(不是手造的,是渲染管线
真吐出来的),再 `fetch` 这个链接,把响应体喂给 `parseAttemptDocument`(客户端那份真实实现,
不是重新写一遍断言)——确认两种语言内容都在、href 编解码往返一致。这条脚本跑通,加上
`App.test.tsx` 的静态渲染测试(`renderToStaticMarkup`,不触发 `useEffect`,只测外壳/导航
不测 dialog 行为)和 `attempt-dialog.test.ts` 的字符串切分单测,是目前能做到的最接近
"浏览器里点一下"的验证。`pnpm run view:build` 编译通过 + 上述脚本跑通,是这次改动能拿到的
全部信号——真人在浏览器里点一次仍然是没做的一步,值得在真正需要强保证时(比如上线前)
用真机核对一次。

# 遗留:两处 cases.md 陈旧行 —— 已在 Phase H 处理

- 第 218 行(`docs/engineering/testing/unit/reports.md`)描述的"前端 artifact fetch 以
  「页面所在目录」为基底"整套语义是 `artifact-url.ts` 的行为——那个模块已删除且无任何替代
  实现或测试,`--out` 相关章节里也没有别的行覆盖同一件事。Phase H 判定为整段作废,直接删除
  该行,不改写成别的措辞(没有对应实现,改写等于凭空发明契约)。
- 第 198/220 行("attempt 详情路由对完整结果根解析")复核后判定**不需要改写**:两行的措辞
  ("深链仍可打开"/"证据可 fetch")本身与实现机制无关,fetch 独立文档 + dialog 的新机制下
  仍然成立;紧邻的另一行("dialog 内容与直接打开该 HTML 文档的内容是同一份 server-rendered
  字节/DOM 片段")已经准确描述了新机制,不需要在 198/220 重复。当初标记待办是保守起见,复核后
  确认无需改动。

关联:[attempt-page-standalone-document-not-spa-shell](attempt-page-standalone-document-not-spa-shell.md)
(同一 Phase 前一次提交,记录独立文档结构本身的设计)。
