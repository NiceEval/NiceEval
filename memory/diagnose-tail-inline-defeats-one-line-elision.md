# diagnose 的 output tail 用 " ⏎ " 拼进单行,击穿全部单行面的一层摘要收口

## 现象

批跑 bub 遇到 "Concurrency limit exceeded" 判死时,scrollback 失败行整段灌进 rich traceback 的框线碎片(`│ ❱ 205 │ … ╰──╯`),被终端折行后像 niceeval 自己的面板框错位。cli.md「运行反馈」明明声明执行错误只输出一层可行动摘要、stack/SDK 输出不进 scrollback,且 `failureDetailFromResult` 也确实做了 `firstLine` 投影,但拦不住。

## 根因

`shared.diagnoseFailure`(src/agents/shared.ts)把 exit code、last error、output tail 三层拼成**一条单行** message——tail 的多行用字面 `" ⏎ "` 连接、切 600 字符。展示细节被烘焙进持久化数据后,所有单行面的 `firstLine` 都无从下手:整条 message 就是一行。这违反 display.md「一条摘要怎样排版」的分工——剥控制字节/折行/截断是**渲染时的展示投影**,落盘存原始字节。另外剥控制字节救不了框线:`│ ╰` 是合法可打印符号,契约明说保留。

## 修法

分层而不是删证据(2026-07-23,修在同日 commit):

- `diagnoseFailure` 首行 = 一层摘要(exit code · transcript 状态 · last error 的**首行**;last error 完整多行文本本就是 events 里的独立事件,截首行不丢证据),output tail 从第二行起按**原始换行**保留(`outputTail` 改 `join("\n")`);i18n `agent.diagnose.outputTail` 模板相应换行。
- 三个单行面各自对 `error.message` 折首行 + `summaryText` 收口:`runner/feedback/failure.ts`(scrollback 失败行 / FAILURES)、`show/render.ts` `verdictReasonLine`(紧凑索引)、`report/components/entity-lists/compute.ts` `failureSummaryOf`(Result 单元格)。
- 完整 tail 的下钻之家不变:`show` attempt 详情的 `error:` 块经 `wrapDisplay`(按 `\n` 分段)多行展开,events.json 存原文。

适用场景:任何往持久化 message 里拼多行原始输出的地方,先问「单行面拿它折首行后还剩什么」——用换行分层,别用行内连接符压平。
