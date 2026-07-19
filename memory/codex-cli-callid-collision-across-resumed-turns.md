---
name: codex-cli-callid-collision-across-resumed-turns
description: "codex exec --json 的 item.id 按单次进程调用从零编号;codex exec resume 续接的下一轮是新进程,同样从 item_0 开始——多轮会话拆成多个 t.send() 时,不同轮的工具调用可能巧合复用同一个 item 号,call ID 配对因此跨轮错位"
metadata:
  type: infra-bug
---

**现象**:`e2e/repos/codex-cli` 的 MCP Eval 里,同一条会话先后调用两个不同 MCP 工具
(`t.send()` 两次,第二次经 `codex exec resume` 续接):第一轮点名 stdio 工具 `e2e.get-sum`
(真实入参 `{a:100,b:23}`,真实返回 "123"),第二轮点名远程 HTTP 工具
`deepwiki.read_wiki_structure`。两次调用在 `codex exec --json` 的原始事件里都**真实发生
且入参/返回都正确**(`events.json` 逐条核对无误),但 `t.calledTool("e2e.get-sum", {status:
"completed", input:{a:100,b:23}})` 断言失败,"received" 展示的却是 `deepwiki.read_wiki_
structure` 那条记录。

**根因**:两条 `action.called`(`e2e.get-sum` 与 `deepwiki.read_wiki_structure`)在归一后
的事件流里拿到了**同一个 `callId`("item_3")**——`codex exec --json` 的 `item.id` 是按
**这一次进程调用**从零编号的局部计数器,不是跨会话全局唯一 id。`codex exec resume <id>`
续接下一轮时会重新 spawn 一个 **新的 OS 进程**,该进程的 `item.id` 计数器同样从 `item_0`
开始。如果两轮各自的"这是第几个 item"恰好相同(常见——两轮提示词结构相似、都只有一次
工具调用时,数字几乎总是相同),niceeval 的会话级累积事件流里就会出现两条不同工具调用共用
同一个 `callId` 的情况;按 call id 配对结果(`action.result`)的匹配器因此可能拿到**后一轮
的结果**去校验**前一轮的调用**,产生"入参/工具名对不上"的假失败。

这与 codex-sdk(`@openai/codex-sdk`)不是同一回事——SDK 在进程内保持同一个 `Thread` 对象
跨轮复用,`item.id` 是这一个对象生命周期内连续递增的计数器,不会重置,因此 SDK 路径不受
影响;只有 CLI 路径(`codex exec` + `codex exec resume` 两次独立进程调用)才会撞见。

**修法(使用侧结论,不是框架修复)**:任何要用 `t.calledTool(..., {status, input})` 断言
"调用与结果按 call id 配对"的场景,如果会话需要触发**多个**工具调用,把它们放进**同一轮**
`t.send()`(一次提示词里点名要做的几件事),不要拆成多个 `t.send()`——同一次 `codex exec`
进程内 item 编号连续递增,不会跨轮碰撞。只有像"跨轮记忆"这类不依赖 call id 配对的断言
(纯读 `message` 文本,或直接 `t.sandbox.runShell` 读 Codex 自己的 session 文件)才能安全地
拆成多轮。

**适用场景**:任何用 `codexAgent`(而非 `codex-sdk` 的 `fromCodexThreadEvents`)、且要在
一条会话线里断言"跨越多轮的多个不同工具调用各自入参正确"的 Eval——把这些调用收进一轮,
或者改用不依赖 call id 配对的证据来源(如直接读 Codex session 文件)。
