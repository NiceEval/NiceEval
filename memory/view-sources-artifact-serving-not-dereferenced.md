# view 的两条 sources.json 出口曾继续吐落盘引用格式,浏览器端代码视图静默判空

## 现象

`attempt-locator-and-source-dedup` 裁决(2026-07-12)把 sources 的持久化改成两层去重存储后
(见 `memory/attempt-locator-and-source-dedup.md`):attempt 目录下的 `sources.json` 从全量
`SourceArtifact[]`(`{path, content}[]`)变成小引用 `{path, sha256}[]`,真内容挪进快照根的
`sources/<sha256>.json`。`src/results/open.ts` 的 `AttemptHandle.sources()` 正确做了两层解引用,
但 view 包两条独立的 artifact 出口都还在假设「sources.json 就是全量内容」:

- `src/view/server.ts` 的 `serveArtifact()`:通用「读 root 下任意 .json 文件、原样 pipe 给
  HTTP 响应」,对 sources.json 没有特判,把引用格式直接发给浏览器。
- `src/view/index.ts` 的 `copyFetchedArtifacts()`(`--out` 静态导出):对 sources.json 做的是
  跟 events.json/trace.json 一样的 `copyFile()` 原字节复制。

浏览器端 `src/view/app/lib/guards.ts` 的 `isCodeSource` 守卫要求 `content: string` 字段,引用
对象没有这个字段,`asSources()` 于是把整份 sources 判空,AttemptModal 的代码视图回退到
「源码未捕获」的空状态——即便这个 attempt 明明捕获了源码。两个出口都没有任何测试真的
经 HTTP/静态导出路径 fetch 一次 sources.json 再拿浏览器端 guard 校验一遍,所以这条回归
在合并时完全没被拦下来。

跟 `memory/static-site-export-drops-sources.md`(0.3.0)是同一症状(代码视图显示源码未捕获),
但根因不同:那次是文件压根没有导出通道(纯缺失);这次文件确实被导出/served 了,只是
格式变了(内容变成了指针)。教训是同一症状可能反复出现,每次都要重新查根因,不能凭
「这个我们修过」就跳过排查。

## 根因

一次持久化格式变更(attempt 级 `sources.json`:全量内容 → 去重引用)只改了「写入面」
(`writer.ts`)和「唯一的官方读取面」(`open.ts` 的 `AttemptHandle.sources()`),但漏改了
两个**旁路读取**这份文件的消费方——它们绕开 `AttemptHandle.sources()` 直接摸盘上的
`sources.json` 字节。`src/results/copy.ts` 的 `copySnapshots` 当时确实改对了(见
`attempt-locator-and-source-dedup.md` 的「sources」小节,它已经在用 `attempt.sources()`
解引用后重新落盘),但 `src/view/` 包的两条出口是同一次格式变更影响半径内、却没有同步复查的
死角。

## 修法

两处都改为「先查这个 base 对应哪个 AttemptHandle,调 `.sources()` 拿到解引用后的完整内容,
再把 JSON.stringify 的结果发出去/写盘」,不再对 sources.json 走「读文件字节直传/直拷」的
通用路径。events.json / trace.json 等其它 artifact 完全不受影响,继续走原文件路径(它们从来
不是两层存储,`.sources()` 是目前唯一有「引用 vs 内容」两层结构的 artifact 类型)。

- `src/view/server.ts`:`serveArtifact()` 新增第四个参数
  `attemptIndex: () => Promise<Map<string, AttemptHandle>>`,只在请求的文件名是
  `sources.json` 时才调用(懒执行,events/trace 请求完全不触发这份索引的构建开销)。
  索引来自 `src/view/data.ts` 新增的 `loadAttemptIndex()`——特意不复用整套
  `loadViewScan()`(会额外跑 Selection 合成 + 报告双语渲染,对一次 artifact fetch 太重),
  只做一次 `openResults()` 扫描,按 `withArtifactBase()` 同一公式建 base → AttemptHandle。
- `src/view/index.ts`:`copyFetchedArtifacts()` 里 sources.json 单独分支,用
  `ViewScan.attemptsByBase`(`loadViewScan()` 已有的那次扫描顺带建好,导出场景不存在
  「按需才建索引」的顾虑,直接读现成的)查到 AttemptHandle 后调 `.sources()`,写出
  JSON.stringify 后的完整内容,而不是 `copyFile()`。

## 回归覆盖

`src/view/artifact-serving.test.ts`:写两个 attempt 共享字节相同的 eval 源码触发真实去重
(`createResultsWriter`,断言 `sources/` 仓库确实只落一份 blob,确保测的是「引用 + 仓库」两层
结构而不是巧合地没有第二层),然后分别真起 `startViewServer()` 用真实 HTTP fetch
`/artifact/<base>/sources.json`,和真跑 `buildView({ out })` 读回导出目录里的 sources.json,
两处都断言拿到的是 `{path, content}[]`(且没有 `sha256` 字段),外加一个 events.json 未受影响
的对照断言。改动前手工把 `server.ts`/`index.ts` 换回改动前版本重跑这份测试,确认会失败
(拿到的是 `{path, sha256}[]`);换回修复版本后转绿——测试确实覆盖到了这条回归路径,不是
装饰性断言。
