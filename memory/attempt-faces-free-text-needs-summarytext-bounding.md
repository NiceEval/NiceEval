---
format: concord.document/v1
id: attempt-faces-free-text-needs-summarytext-bounding
title: attempt-faces-free-text-needs-summarytext-bounding
createdAt: 2026-07-19T16:44:26+08:00
createdAtSource:
  kind: first-recorded
  path: memory/attempt-faces-free-text-needs-summarytext-bounding.md
  commit: 4c248a67d8878a8e1b556ae81a23fc4011a1564e
description: 已修——真实 repo 冒烟才暴露:attempt-faces.ts 里多处自由文本(断言 received/expected、错误
  message、对话逐条回复)未收口,整份源码/system prompt 会原样灌进一行
kind: memory
memoryKind: problem
state: resolved
epoch: 0
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: 已修——真实 repo 冒烟才暴露:attempt-faces.ts 里多处自由文本(断言 received/expected、错误
      message、对话逐条回复)未收口,整份源码/system prompt 会原样灌进一行
    proof: []
    source:
      path: memory/attempt-faces-free-text-needs-summarytext-bounding.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:b0da86eeb7279aacc9e5506a9f76e40a1662faaed506046d4535ca5be9ca3451
---

Phase E 用 3 条手造 fixture(source 可用/不可用/errored)走查过 `standardAttemptPage`,组件级和树级测试都全绿。
但按 CLAUDE.md「CLI 改动要在真实 dogfood repo 里跑」的要求,在 `/Users/ctrdh/Code/coding-agent-memory-evals`
跑 `pnpm exec niceeval show @<locator>` 后发现:一条 `includes(/regex/)` 断言失败时,`received:` 字段把
被检查的**整份 React 页面源文件**(几百行)原样拼进了一行输出;`conversation:` 段每条 round 的
`sentText`/回复 `text` 同样把完整 system prompt、完整消息正文原样输出。手造 fixture 用的都是几个字符的
短字符串,这类"真实值可以长达几 KB"的情况在合成测试里从未出现过。

# 根因

`src/report/text/attempt-faces.ts` 里散落的自由文本字段(`AssertionResult.expected/received`、
`AttemptErrorData.message`/`cause.message`、`AttemptDiagnosticsData` 每条 `message`、
`AttemptConversationReply` 里 assistant/user/thinking/error 的 `text`、`input.request.prompt`、
`raw.raw` 的 JSON)全部直接字符串拼接,没有走 scoring 子系统已有的 `summaryText()`
(`src/scoring/display.ts`,单行折叠 + 240 字符上限)。这条规则本来就写在本文件顶部注释里
("text 面允许把大块内容折成摘要...不得改变判定、计数或引用"),但第一版实现只对"要不要显示这个字段"
做了判断,没有对"字段值本身可能任意大"做处理。

# 修法

`summaryText()` 包一层,分两类:
- **折**:`assertionLine` 的 `expected`/`received`、`attemptErrorText` 的 `message`/`cause.message`、
  `attemptDiagnosticsText` 的 `message`、`attemptConversationText`/`replySummary` 的所有消息文本类
  字段(assistant/user/thinking/error/input.prompt/compaction.reason/raw 的 JSON)。
- **不折**:`attemptErrorText` 的 `stack`——旧 `renderErrorBlock` 就特意保留多行 stack 在块尾,且没有
  `--stack` 之类的独立深挖入口能找回原文,是唯一"多行天生如此 + 无替代查看方式"的字段,折叠会真的丢信息。

判据(可复用于以后新增字段时判断要不要折):这个值是"结构化事实"(verdict、计数、phase 名、路径、
locator、`file:line:col` 锚点)还是"自由文本块"(消息正文、日志、被检查的源文件内容)?后者且有替代
深挖入口(`--source`/`--execution`/`--diff` 等)的,一律 `summaryText()`。

# 方法论:合成 fixture 走查 ≠ 真实数据走查

与 [attempt-detail-component-level-green-composite-broken](attempt-detail-component-level-green-composite-broken.md)
是同一类"组件级/合成级测试测不出来,只有更真实的一层验证才能暴露"的问题,但这次连"拼成整页" 这层都不够——
根源是**合成 fixture 的字段长度分布不真实**(手写测试数据人为地短)。CLAUDE.md 要求 CLI 改动过 dogfood repo
冒烟不是形式主义:这次的问题只有跑真实 agent 产生的真实 attempt 数据才会现形,任何长度都可控的手造 fixture
都测不出"这个字段在真实世界里可以是几 KB"这件事。以后新增/大改 text 面渲染逻辑,合成测试通过后,提交前仍要
过一次真实 dogfood repo 的真实失败 attempt。
