# 事件流含 user message + 源码对齐(source-loc / code view)

## 现象

1. view 的旧 `events.json` 工件里只有 assistant 消息,模态框看不到对话(更别说 send 内容)——但代码里明明把 user message push 进流了。
2. `t.event("message", { count: 3 })` 在三轮对话里数到了 6,断言失败(示例 `multi-turn-text.eval.ts` 受影响)。
3. `t.messageIncludes(token)` 可能命中**用户发的**文字而误判通过。

## 根因

`src/context/session.ts` 的 `SessionManager.send()` 会把 `{ type:"message", role:"user", text, loc }` push 进 `allEvents`;`allEvents` 同时是**评分输入**(`ctx.events`)、**保存工件**(`result.events`)。于是:

- 旧工件是在「push user message」这行(commit d9a9721,15:38)**之前**生成的(07:07),所以只有 assistant —— 工件失效,必须 `--fresh` 重新跑才有对话。
- message 计数 / 扫描类断言原来默认整个流只有 assistant,现在混进了 user,语义变了。

## 修法

- `messageIncludes`(`src/scoring/scoped.ts`)已改为只看 `role === "assistant"`。这是「断言助手说了什么」的本意,且避免扫到用户输入误判。
- `event("message", { count })` 仍按**全部** message(含 user)计数 —— 写这类断言要么按真实(含 user)数,要么改用 `succeeded()` / `messageIncludes`。示例若用 `count:3` 表示「三轮助手回复」会误失败,需调整。
- **user message 必须留在流里**:view 的代码视图靠 user message 上的 `loc`(`src/source-loc.ts` 的 `captureLoc()`,在 `SessionManager.send` / `AssertionCollector.record` 里栈回溯抓「第一帧非 niceeval src」)把 send / 断言叠回真实源码行。别为了修计数把 user message 移出流。

## 相关:source-loc / code view 数据结构

- `SourceLoc { file, line }` 挂在 message 事件(user)与 `AssertionResult` 上;`EvalResult.sources`(= 引用到的 eval 源码,`run.ts` 的 `collectSources` 按 cwd 读)由 Artifacts reporter 写成 `sources.json`。
- view(`src/view/app/main.jsx` 的 `CodeView`)读 `sources.json` + `events.json`,按 `file:line` 把每条 send(折叠→展开看回复)/ 断言(过绿不过红 + judge 分数 + 展开看 CoT)叠回源码行。
- judge 的 `agent`/`score` 原来 SYSTEM_PROMPT 逼模型「只输出数字」,没 CoT 可看;已改为输出 `{reasoning, score}` JSON,`judge.ts` 的 `parseJudgeReply` 把 reasoning 落 `detail`。

## 验证夹具

`test/view-harness/`:mock 进程内 agent + 本机 mock judge(OpenAI 兼容),不联网/不起沙箱。
`node test/view-harness/run.mjs` 重新生成 `.niceeval`,再 `node bin/niceeval.js view test/view-harness/.niceeval` 看效果。
